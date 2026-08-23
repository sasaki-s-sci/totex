#!/bin/sh
#
# Installs a released totex on macOS or Linux.
#
# One script, any released version. Nothing about a version is built into this
# file: which one to install is decided by the `latest.json` it reads, so the
# copy of this script downloaded today still installs the version asked for a
# year from now, and there is one installer to point people at rather than one
# per release. `--version` picks the release; without it, the newest.
#
# What it fetches is exactly what the app fetches to update itself -- the same
# manifest, the same bundle, checked against the same key -- because there is
# no reason for a machine to have two ways in and only one of them checked. An
# install is the first update, and this is what does it before there is an app
# to do it.
#
# Run it with --help for what it takes.

set -eu

REPO="sasaki-s-sci/totex"

# The key every release is signed with, verbatim from `plugins > updater >
# pubkey` in src-tauri/tauri.conf.json -- the build refuses to run if the two
# ever stop being the same string. It is the app's own key on purpose: a
# download this script accepts is one the installed app would also accept.
PUBKEY="dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEE1Mzg0NDdDQzMyRjc5RjIKUldUeWVTL0RmRVE0cFNIcTBWL3FCbDV3MzZRVm95ZjZUdWZWazdVWEJVNGppRGdoNkNLanE1eDgK"

VERSION=""
DIR=""

main() {
  parse_arguments "$@"
  find_tools

  work=$(mktemp -d "${TMPDIR:-/tmp}/totex-install.XXXXXX")
  trap 'rm -rf "$work"' EXIT INT TERM

  target=$(this_machine)
  manifest="$work/latest.json"
  fetch "$(manifest_url)" "$manifest" || die "there is no release to install$(
    [ -n "$VERSION" ] && printf ' at v%s' "$VERSION"
  )"

  released=$(json_string "$(head -n 4 "$manifest")" version)
  [ -n "$released" ] || die "the release manifest says nothing about a version"
  if [ -n "$VERSION" ] && [ "$VERSION" != "$released" ]; then
    die "v$VERSION was asked for and the release under that tag says $released"
  fi

  entry=$(sed -n "/\"$target\": {/,/}/p" "$manifest")
  url=$(json_string "$entry" url)
  signature=$(json_string "$entry" signature)
  [ -n "$url" ] && [ -n "$signature" ] ||
    die "totex $released has nothing for $target"

  bundle="$work/$(basename "$url")"
  say "Downloading totex $released"
  fetch "$url" "$bundle" || die "$url could not be downloaded"

  printf '%s' "$signature" | b64d >"$work/signature"
  verify "$bundle" "$work/signature"

  case "$target" in
    darwin-*) install_app "$bundle" "$released" ;;
    linux-*) install_appimage "$bundle" "$released" ;;
  esac
}

parse_arguments() {
  while [ $# -gt 0 ]; do
    case "$1" in
      --version)
        [ $# -ge 2 ] || die "--version wants a version"
        VERSION=${2#v}
        shift 2
        ;;
      --version=*) VERSION=${1#--version=}; VERSION=${VERSION#v}; shift ;;
      --dir)
        [ $# -ge 2 ] || die "--dir wants a path"
        DIR=$2
        shift 2
        ;;
      --dir=*) DIR=${1#--dir=}; shift ;;
      -h | --help) usage; exit 0 ;;
      *) die "$1 is not something this understands -- try --help" ;;
    esac
  done

  if [ -n "$VERSION" ]; then
    printf '%s' "$VERSION" | grep -Eq '^[0-9]+\.[0-9]+\.[0-9]+$' ||
      die "$VERSION is not a version"
  fi
}

# Written out rather than read back out of this file: the usual way to run this
# is straight down a pipe, where there is no file to read.
usage() {
  cat <<'USAGE'
Usage: install.sh [--version X.Y.Z] [--dir PATH]

  --version   A released version, with or without the leading v. The newest
              release if this is left out. A version asked for here is what
              stays installed -- the app's own update button is what moves it
              on from there.
  --dir       Where the app goes. On macOS the folder the .app is put in,
              /Applications or ~/Applications by default; on Linux the folder
              holding the AppImage, under ~/.local/share by default.
USAGE
}

# The manifest to read. Every release carries one under a fixed name, which is
# what makes both of these a single unchanging URL: the newest release always
# answers the first, and a release that has already happened always answers the
# second with what it shipped, whatever has been released since.
manifest_url() {
  if [ -n "$VERSION" ]; then
    printf 'https://github.com/%s/releases/download/v%s/latest.json' "$REPO" "$VERSION"
  else
    printf 'https://github.com/%s/releases/latest/download/latest.json' "$REPO"
  fi
}

# Which of the manifest's entries describes this machine. The names are the
# updater's, not the platform's: they say what kind of installed copy is being
# replaced, and only the kinds that can replace themselves are listed. Nothing
# answers for a `.deb`, an `.rpm` or an architecture no release is built for,
# which is why those fall through to the error below rather than to a download.
this_machine() {
  machine=$(uname -m)
  case "$(uname -s)" in
    Darwin)
      case "$machine" in
        arm64 | aarch64) printf 'darwin-aarch64' ;;
        x86_64) printf 'darwin-x86_64' ;;
        *) die "there is no totex for $machine Macs" ;;
      esac
      ;;
    Linux)
      case "$machine" in
        x86_64 | amd64) printf 'linux-x86_64-appimage' ;;
        *) die "there is no totex for $machine Linux" ;;
      esac
      ;;
    *) die "$(uname -s) is not a platform totex is released for" ;;
  esac
}

# --- what the machine already has -------------------------------------------

find_tools() {
  if command -v curl >/dev/null 2>&1; then
    FETCH=curl
  elif command -v wget >/dev/null 2>&1; then
    FETCH=wget
  else
    die "this needs curl or wget to download anything"
  fi

  # Every one of these decodes standard base64; which flag says so is the only
  # thing they disagree about.
  for candidate in "base64 -d" "base64 -D" "openssl base64 -d -A"; do
    if printf 'dG90ZXg=' | $candidate >/dev/null 2>&1; then
      B64D=$candidate
      break
    fi
  done
  [ -n "${B64D:-}" ] || die "this needs base64 or openssl to read a signature"

  find_verifier
}

fetch() {
  case "$FETCH" in
    curl) curl -fsSL --proto '=https' --tlsv1.2 -o "$2" "$1" ;;
    wget) wget -q --https-only -O "$2" "$1" ;;
  esac
}

b64d() { $B64D; }

# The value of one string field, read out of a fragment of the manifest. The
# fields wanted are all one line of `"name": "value"` with nothing quoted
# inside them -- versions, base64 and URLs -- so this is the whole of the JSON
# that has to be understood, and jq is not something to make anybody install.
json_string() {
  printf '%s\n' "$1" | sed -n "s/.*\"$2\": *\"\([^\"]*\)\".*/\1/p" | head -n 1
}

# --- verifying ---------------------------------------------------------------
#
# The manifest carries, beside every download, the signature the app checks
# before it replaces itself with it. This checks the same signature before it
# puts anything on the machine, so that a release page that has been tampered
# with is turned down here exactly as it would be turned down there.
#
# Neither of the two ways of checking it is written out below. minisign does it
# in one command; an openssl new enough to know both halves does it in four,
# because a tauri signature is minisign's prehashed kind -- a raw Ed25519
# signature over the BLAKE2b-512 of the file. What is deliberately not here is
# the arithmetic itself: hand-written crypto in the one thing standing between
# a download and the machine would be worse than the tampering it is meant to
# catch.

find_verifier() {
  if command -v minisign >/dev/null 2>&1; then
    VERIFIER=minisign
    return
  fi

  # LibreSSL -- which is what /usr/bin/openssl is on a Mac -- knows neither
  # half, so a Homebrew openssl is looked for by the paths brew puts it at
  # before giving up on the platform.
  for candidate in \
    openssl \
    /opt/homebrew/opt/openssl@3/bin/openssl \
    /usr/local/opt/openssl@3/bin/openssl; do
    command -v "$candidate" >/dev/null 2>&1 || continue
    printf '' | "$candidate" dgst -blake2b512 >/dev/null 2>&1 || continue
    VERIFIER=$candidate
    return
  done

  die "totex releases are signed and nothing here can check the signature.
Install minisign -- 'brew install minisign' on macOS, or the 'minisign'
package on Linux -- and run this again."
}

verify() {
  say "Checking the signature"
  if [ "$VERIFIER" = minisign ]; then
    minisign -Vqm "$1" -x "$2" -P "$(printf '%s' "$PUBKEY" | b64d | sed -n 2p)" ||
      die "the download is not signed by the key totex is released with"
    return
  fi
  verify_with_openssl "$1" "$2"
}

verify_with_openssl() {
  bundle=$1
  document=$2

  [ "$(sed -n 2p "$document" | b64d | head -c 2)" = "ED" ] ||
    die "the signature is not of the kind totex is released with"

  # A minisign public key is two bytes of algorithm, eight of key id and then
  # the Ed25519 key; the same shape holds the signature, with 64 bytes at the
  # end of it. openssl wants the key wrapped in the twelve bytes of DER that
  # say what it is, and that prefix is a whole number of base64 characters, so
  # the two encode and decode as one string.
  key=$(printf '%s' "$PUBKEY" | b64d | sed -n 2p | b64d | tail -c 32 | "$VERIFIER" base64 -A)
  printf '%s%s' 'MCowBQYDK2VwAyEA' "$key" | b64d >"$work/pub.der"
  sed -n 2p "$document" | b64d | tail -c 64 >"$work/signature.raw"
  "$VERIFIER" dgst -blake2b512 -binary -out "$work/digest" "$bundle"

  # The verifier is asked to say no before it is trusted to say yes: an openssl
  # that accepts a digest with a byte on the end of it is one whose acceptance
  # of the real digest would mean nothing at all.
  cat "$work/digest" >"$work/digest.wrong"
  printf '!' >>"$work/digest.wrong"
  if openssl_accepts "$work/digest.wrong" "$work/signature.raw"; then
    die "the signature check is not working -- it accepted a file it should have refused"
  fi

  openssl_accepts "$work/digest" "$work/signature.raw" ||
    die "the download is not signed by the key totex is released with"

  # minisign signs its trusted comment as well, and checking one signature and
  # not the other would leave "verified" meaning something narrower here than
  # it means everywhere else the word is used about this key.
  {
    cat "$work/signature.raw"
    sed -n 3p "$document" | sed 's/^trusted comment: //' | tr -d '\n'
  } >"$work/global.message"
  sed -n 4p "$document" | b64d >"$work/global.raw"
  openssl_accepts "$work/global.message" "$work/global.raw" ||
    die "the signature's own comment is not signed by the key totex is released with"
}

openssl_accepts() {
  "$VERIFIER" pkeyutl -verify -pubin -inkey "$work/pub.der" -keyform DER \
    -rawin -in "$1" -sigfile "$2" >/dev/null 2>&1
}

# --- putting it where it belongs ---------------------------------------------

# macOS: the bundle is the app itself, and the folder it goes in is the one the
# Finder looks in. /Applications when that can be written to without asking for
# a password -- which is the usual case for the account that set the Mac up --
# and the account's own Applications folder when it cannot.
install_app() {
  bundle=$1
  released=$2

  tar -xzf "$bundle" -C "$work" || die "the download is not a readable archive"
  app=$(find "$work" -maxdepth 1 -name '*.app' | head -n 1)
  [ -n "$app" ] || die "the download does not hold an app"

  destination=$DIR
  if [ -z "$destination" ]; then
    if [ -w /Applications ]; then destination=/Applications; else destination="$HOME/Applications"; fi
  fi
  mkdir -p "$destination"
  destination=$(cd "$destination" && pwd)

  installed="$destination/$(basename "$app")"
  rm -rf "$installed"
  mv "$app" "$installed"

  # Quarantine is what makes a downloaded app ask to be let out of it before it
  # will open. Nothing here arrived through a browser, so there is usually
  # nothing to clear, and clearing it is what stops the release's own
  # instructions being something anybody has to read.
  xattr -dr com.apple.quarantine "$installed" 2>/dev/null || true

  say "totex $released is in $destination"
  say "Open it from Launchpad, or with: open '$installed'"
}

# Linux: the AppImage is one file and the app updates itself by writing over
# it, so it goes somewhere the account owns. What is put beside it is what
# makes it an application rather than a file -- a name on the menu, an icon,
# and something on the PATH to type.
install_appimage() {
  bundle=$1
  released=$2

  destination=${DIR:-${XDG_DATA_HOME:-$HOME/.local/share}/totex}
  mkdir -p "$destination"
  # The menu entry written below holds a path rather than a name to look up,
  # and a relative one there is a menu entry that works from one directory.
  destination=$(cd "$destination" && pwd)
  installed="$destination/totex.AppImage"
  cp "$bundle" "$installed"
  chmod 755 "$installed"

  bin="$HOME/.local/bin"
  mkdir -p "$bin"
  ln -sf "$installed" "$bin/totex"

  icon=""
  if (cd "$work" && "$installed" --appimage-extract totex.png >/dev/null 2>&1); then
    icon="$destination/totex.png"
    cp "$work/squashfs-root/totex.png" "$icon"
  fi

  applications="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
  mkdir -p "$applications"
  cat >"$applications/totex.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=totex
Comment=Git graph, worktrees and the terminals they are worked in
Exec=$installed
Icon=${icon:-totex}
Categories=Development;RevisionControl;
Terminal=false
StartupWMClass=totex
DESKTOP
  update-desktop-database "$applications" >/dev/null 2>&1 || true

  say "totex $released is at $installed"
  case ":$PATH:" in
    *":$bin:"*) say "Run it from the menu, or with: totex" ;;
    *) say "Run it from the menu, or with: $bin/totex ($bin is not on your PATH)" ;;
  esac
}

say() { printf '%s\n' "$*" >&2; }
die() { printf '%s\n' "$*" >&2; exit 1; }

main "$@"

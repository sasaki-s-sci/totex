//! The shell scripts the remote half of every operation runs.

/// One path, as `%y` (what it is) `%Y` (what it points at) size and mtime.
pub(super) const STAT: &str = r#"
if [ -L "$1" ] && [ -e "$1" ]; then
    printf 'l\t'
    exec find -H "$1" -maxdepth 0 -printf '%Y\t%s\t%T@\n'
fi
exec find "$1" -maxdepth 0 -printf '%y\t%Y\t%s\t%T@\n'
"#;

/// One directory's children, NUL-terminated so a newline in a name is a name.
pub(super) const LIST: &str =
    r#"exec find -H "$1" -maxdepth 1 -mindepth 1 -printf '%y\t%Y\t%s\t%T@\t%p\0'"#;

/// The same, for as many directories as were asked about at once.
pub(super) const LIST_MANY: &str =
    r#"exec find -H "$@" -maxdepth 1 -mindepth 1 -printf '%y\t%Y\t%s\t%T@\t%p\0'"#;

/// How long a file is, then as much of it as was asked for.
pub(super) const HEAD: &str = r#"
[ -e "$1" ] || exit 2
[ -d "$1" ] && exit 3
size=$(wc -c <"$1") || exit 4
printf '%s\n' "$size"
exec head -c "$2" -- "$1"
"#;

/// A file written back over itself, and only while it is the length it was.
/// Written in place rather than replaced, so whatever the file already is — a
/// symlink, a mode, an owner, a hard link — it stays.
pub(super) const WRITE: &str = r#"
[ -e "$1" ] || exit 2
[ -d "$1" ] && exit 3
[ "$(wc -c <"$1")" = "$2" ] || exit 4
printf '%s' "$3" | base64 -d >"$1"
"#;

/// The original bytes arrive as one base64 line, followed by the replacement on stdin.
pub(super) const WRITE_CHECKED: &str = r#"
[ -e "$1" ] || exit 2
[ -d "$1" ] && exit 3
[ "$(wc -c <"$1")" = "$2" ] || exit 4
IFS= read -r expected || exit 1
actual=$(base64 <"$1" | tr -d '\n') || exit 1
[ "$actual" = "$expected" ] || exit 4
cat >"$1"
"#;

/// Bytes into a file that is not there, refusing to replace one that is.
///
/// The far end of a copy out of somewhere this machine cannot hand to `cp` —
/// another distribution, or a disk it has no name for inside this one. The
/// bytes arrive on stdin. Noclobber also refuses a file created after the checks.
pub(super) const PUT: &str = r#"
[ -e "$1" ] && exit 3
[ -L "$1" ] && exit 3
if [ -n "$2" ]; then
    parent=${1%/*}
    [ "$parent" = "$1" ] && parent=.
    [ -n "$parent" ] || parent=/
    stage=$(mktemp -d -- "$parent/.totex-put.XXXXXXXXXX") || exit 1
    trap 'rm -rf -- "$stage"' EXIT
    exec 3>"$stage/file"
    chmod -- "$2" /dev/fd/3 || exit 1
    cat >&3 || exit 1
    mv -nT -- "$stage/file" "$1" || exit 1
    [ ! -e "$stage/file" ] || exit 3
    exit 0
fi
set -C
exec 3>"$1"
cat >&3 || { rm -f -- "$1"; exit 1; }
"#;

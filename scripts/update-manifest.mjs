/**
 * Writes the file the app reads when it is told to look for a new version.
 *
 * The updater asks one URL and expects one small JSON document back: what the
 * newest version is, and — for the exact kind of copy doing the asking — where
 * its replacement is and the signature it has to carry. That document is not
 * something a release page produces, so it is built here out of what the three
 * build jobs actually made and uploaded alongside them, under the fixed name
 * the app is pointed at.
 *
 * ## Why the keys look like that
 *
 * The updater does not ask for a platform, it asks for a kind of installed
 * copy: `linux-x86_64-appimage`, not `linux`. That is deliberate on its part
 * and it is the only thing that makes this safe — a `.deb` install is files a
 * package manager owns, and handing it an AppImage to overwrite itself with
 * would leave the manager describing a version that is no longer there. So
 * nothing is listed for `.deb` or `.rpm`, the app never offers those the whole
 * of an update (see `src-tauri/src/update`), and the lookup falls through to
 * nothing rather than to the wrong file.
 *
 * macOS is the one platform listed twice. One universal build serves both
 * processors, but the updater asks as the machine it is running on, so both
 * names have to point at the same download.
 *
 * ## And the entries that are not platforms
 *
 * `front` is the pages the window is drawn out of, which every kind of
 * installed copy can take on its own without replacing the program under
 * them, including the two the updater will not touch. They are the same pages
 * on all three platforms, so there is one download and no platform in its
 * name. `needs` beside it is the agreement they were built to -- see
 * `frontContract` in package.json -- which is what a copy that cannot replace
 * its program reads before it takes them.
 *
 * `programs` is the app's own executable, out of the installer rather than in
 * it. Nothing installed reads this one — an installed copy replaces its program
 * by running a per-version installer over the top of itself, which is what
 * `platforms` is for. It is read by the machine that has no installed copy
 * yet: setup/, the version-selectable installer, which asks which release to
 * put on and then puts it on, and needs the program itself to do that rather
 * than another installer to run. Only Windows has one because only Windows has
 * that installer.
 *
 * ## Why every one of them is required
 *
 * A missing key is not a smaller release, it is a platform that silently never
 * updates again — nobody would find out until the version after next. So this
 * refuses to write a document it cannot fill.
 *
 * ## One cycle
 *
 * Every release is tagged `vX.Y.Z` and publishes this one document. Which
 * part of the number turned over says what the release replaces -- see
 * `.github/workflows/release.yml` -- and nothing about the document depends
 * on it: a patch and a minor are the same file, and the app reads the
 * version out of it.
 *
 * Usage: node scripts/update-manifest.mjs <directory> <tag>
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/** What a release is tagged under, and what it publishes -- the names
 * `src-tauri/src/release/url.rs` reads back. */
const TAG = "v";
const MANIFEST = "latest.json";

/** The pages of the release, packed by the build job that produced `dist`. */
const FRONT = "front.tar.gz";

/**
 * The program of the release, out of its installer, one per kind of machine.
 *
 * Windows and nothing else, because the version-selectable installer is a
 * Windows program and it is the only thing that reads these. The name is the
 * one .github/workflows/build.yml collects it under, which is the artifact's
 * own name and what the file is — the same rule every other download follows.
 */
const PROGRAMS = [{ name: "totex-windows-x86_64.exe", targets: ["windows-x86_64"] }];

/**
 * Which kind of copy each bundle replaces.
 *
 * Matched on the end of the name, which is the half of it the build fixes:
 * every bundle is collected under the name of the artifact it came out of and
 * what the file is -- totex-windows-x86_64-setup.exe -- so what is written
 * below is the second half of the names .github/workflows/build.yml gives
 * them, and moving one without the other is a platform this stops finding.
 *
 * Read in order, so the longer suffix comes first: every NSIS installer is
 * also an `.exe`, and only one of the two is the one being matched.
 */
const KINDS = [
  { suffix: "-setup.exe", targets: ["windows-x86_64-nsis"] },
  { suffix: ".msi", targets: ["windows-x86_64-msi"] },
  { suffix: ".AppImage", targets: ["linux-x86_64-appimage"] },
  { suffix: ".app.tar.gz", targets: ["darwin-aarch64", "darwin-x86_64"] },
];

const [directory, tag] = process.argv.slice(2);
if (!directory || !tag) {
  fail("usage: node scripts/update-manifest.mjs <directory> <tag>");
}
if (!/^v\d+\.\d+\.\d+$/.test(tag)) {
  fail(`${tag} is not a tag of a release, which is ${TAG}X.Y.Z`);
}
const version = tag.slice(TAG.length);

// Actions names the repository; anywhere else this is a repository with one
// place to be released from, which is where the app is pointed.
const repository = process.env.GITHUB_REPOSITORY || "sasaki-s-sci/totex";
const files = readdirSync(directory).sort();

// What the pages of this release were built to talk to. Written in one place
// -- package.json -- and read from there by both halves: `src-tauri/build.rs`
// puts it into the program, and this puts it beside the download, so a copy
// can tell before it downloads anything whether the two would understand each
// other. See `choose` in src-tauri/src/front/take.rs.
const packageJson = fileURLToPath(new URL("../package.json", import.meta.url));
const { frontContract } = JSON.parse(readFileSync(packageJson, "utf8"));

const said = [];
const manifest = {
  version,
  pub_date: new Date().toISOString(),
  platforms: platforms(),
  front: front(),
  programs: programs(),
};

const out = join(directory, MANIFEST);
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${out}\n`);
for (const line of said) process.stdout.write(`  ${line}\n`);

/** Where every kind of installed copy's replacement for itself is. */
function platforms() {
  const found = {};
  for (const name of files) {
    if (name.endsWith(".sig")) continue;
    const kind = KINDS.find((candidate) => name.endsWith(candidate.suffix));
    if (!kind) continue;

    const signature = signatureOf(name);
    const url = downloadOf(name);
    for (const target of kind.targets) {
      if (found[target]) {
        fail(`two downloads claim ${target}: ${found[target].name} and ${name}`);
      }
      found[target] = { name, signature, url };
    }
  }

  const wanted = KINDS.flatMap((kind) => kind.targets);
  const missing = wanted.filter((target) => !found[target]);
  if (missing.length > 0) {
    fail(`nothing to update ${missing.join(", ")} with`);
  }
  for (const target of wanted) said.push(`${target}  ${found[target].name}`);
  // `name` was only ever for the errors above; the app reads the two.
  return Object.fromEntries(
    wanted.map((target) => [
      target,
      { signature: found[target].signature, url: found[target].url },
    ]),
  );
}

/** Where the pages of this release are, and what they need to run against. */
function front() {
  if (!Number.isInteger(frontContract)) {
    fail("package.json declares no frontContract to publish the pages under");
  }
  if (!files.includes(FRONT)) {
    fail(`nothing to update the pages with: no ${FRONT} was built`);
  }
  said.push(`front (needs ${frontContract})  ${FRONT}`);
  return { needs: frontContract, signature: signatureOf(FRONT), url: downloadOf(FRONT) };
}

/**
 * Where each kind of machine's program is, on its own.
 *
 * No number beside it the way the pages carry one. The pages declare what they
 * need, because they can end up beside a program out of another release. This
 * cannot: it is the program of this release, and what installs it installs the
 * whole of that release at once.
 */
function programs() {
  const found = {};
  for (const kind of PROGRAMS) {
    if (!files.includes(kind.name)) {
      fail(`nothing for the version-selectable installer to install: no ${kind.name} was built`);
    }
    const entry = { signature: signatureOf(kind.name), url: downloadOf(kind.name) };
    for (const target of kind.targets) found[target] = entry;
    said.push(`program  ${kind.name}  ${kind.targets.join(", ")}`);
  }
  return found;
}

/**
 * What the app checks a download against, which is the whole reason a stolen
 * release page cannot hand anybody a different binary.
 */
function signatureOf(name) {
  try {
    return readFileSync(join(directory, `${name}.sig`), "utf8").trim();
  } catch {
    return fail(`${name} has no signature beside it — the build was not signed`);
  }
}

/** Where a file of this release will answer from once it is published. */
function downloadOf(name) {
  return `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(name)}`;
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

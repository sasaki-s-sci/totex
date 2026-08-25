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
 * of an update (see `src-tauri/src/update.rs`), and the lookup falls through to
 * nothing rather than to the wrong file.
 *
 * macOS is the one platform listed twice. One universal build serves both
 * processors, but the updater asks as the machine it is running on, so both
 * names have to point at the same download.
 *
 * ## And the entries that are not platforms
 *
 * `front` and `layers` are the other two thirds of the app. The pages the
 * window is drawn out of are the first: every kind of installed copy can take
 * them on its own without replacing the program under them, including the two
 * the updater will not touch. They are the same pages on all three platforms,
 * so there is one download and no platform in its name.
 *
 * The application layer is the second: a small program the app runs beside
 * itself and asks everything it asks of the machine, which can be replaced
 * without the window being reloaded or a single terminal being ended. That one
 * is a program, so there is one per kind of machine — but a kind of machine and
 * not a kind of installed copy, because nothing about how a copy got onto the
 * disk changes which program can run beside it.
 *
 * What makes both of them keys of their own rather than more platforms is that
 * nothing in the updater plugin reads either. It reads what it knows and
 * ignores the rest; `src-tauri/src/front` and `src-tauri/src/app_layer` read
 * these, out of the same document, because what the newest release is should
 * not be several files that can disagree.
 *

 * ## Why every one of them is required
 *
 * A missing key is not a smaller release, it is a platform that silently never
 * updates again — nobody would find out until the version after next. So this
 * refuses to write a document it cannot fill.
 *
 * ## One document per cycle
 *
 * The three layers can be released apart from one another — see
 * `src-tauri/src/release/cycle.rs` — and a cycle is a tag its versions are cut
 * under and a document each of its releases publishes. A release of the app is
 * the cycle where all three move together and it publishes all of it; a release
 * of one layer publishes that layer alone, under a name of its own, and an
 * installed copy asks whichever of them its rows have been pointed at.
 *
 * Usage: node scripts/update-manifest.mjs <directory> <tag> [release|layer|front]
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Which cycle publishes what, and under which name.
 *
 * The names on the left are the ones `src-tauri/src/release/cycle.rs` knows,
 * and the two fields are the two halves of what a cycle is there: what its
 * versions are tagged under, and what a release of it publishes. Two lists in
 * two languages, which is what the app's own reading of this document holds
 * them together.
 */
const CYCLES = {
  release: { tag: "v", manifest: "latest.json", holds: ["platforms", "front", "layers"] },
  layer: { tag: "layer-v", manifest: "layer.json", holds: ["layers"] },
  front: { tag: "front-v", manifest: "front.json", holds: ["front"] },
};

/** The pages of the release, packed by the build job that produced `dist`. */
const FRONT = "front.tar.gz";

/**
 * The application layer of the release, one per kind of machine.
 *
 * Not one per kind of installed copy, the way the installers are: a layer is a
 * program that is started and asked things, so the only thing that decides
 * which one runs is the operating system and the processor. The names on the
 * right are what `release::target()` builds out of `std::env::consts` — see
 * `src-tauri/src/release.rs`, which is the other half of this list.
 *
 * macOS is listed twice for the same reason it is below: one universal build
 * serves both processors, and the app asks as the machine it is running on.
 */
const LAYERS = [
  { name: "totex-layer-linux-x86_64.gz", targets: ["linux-x86_64"] },
  { name: "totex-layer-windows-x86_64.gz", targets: ["windows-x86_64"] },
  { name: "totex-layer-macos-universal.gz", targets: ["macos-aarch64", "macos-x86_64"] },
];

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

const [directory, tag, named = "release"] = process.argv.slice(2);
if (!directory || !tag) {
  fail("usage: node scripts/update-manifest.mjs <directory> <tag> [release|layer|front]");
}
const cycle = CYCLES[named];
if (!cycle) {
  fail(`${named} is not a cycle: ${Object.keys(CYCLES).join(", ")}`);
}
if (!tag.startsWith(cycle.tag)) {
  fail(`${tag} is not a tag of the ${named} cycle, which cuts ${cycle.tag}X.Y.Z`);
}
const version = tag.slice(cycle.tag.length);

// Actions names the repository; anywhere else this is a repository with one
// place to be released from, which is where the app is pointed.
const repository = process.env.GITHUB_REPOSITORY || "sasaki-s-sci/totex";
const files = readdirSync(directory).sort();

// What the pages and the layer of this release were built to talk to. Written
// in one place -- package.json -- and read from there by both halves:
// `src-tauri/build.rs` and `src-tauri/layer/build.rs` put them into the two
// programs, and this puts them beside the downloads, so a copy can tell before
// it downloads anything whether the two would understand each other. See
// `choose` in src-tauri/src/front/take.rs and `PROTOCOL` in
// src-tauri/layer/src/call.rs.
const packageJson = fileURLToPath(new URL("../package.json", import.meta.url));
const { frontContract, layerProtocol } = JSON.parse(readFileSync(packageJson, "utf8"));

const manifest = { version, pub_date: new Date().toISOString() };
const said = [];
for (const holds of cycle.holds) {
  manifest[holds] = { platforms, front, layers }[holds]();
}

const out = join(directory, cycle.manifest);
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

/** Where each kind of machine's application layer is. */
function layers() {
  if (!Number.isInteger(layerProtocol)) {
    fail("package.json declares no layerProtocol to publish the layer under");
  }
  const found = {};
  for (const kind of LAYERS) {
    if (!files.includes(kind.name)) {
      fail(`nothing to update the application layer with: no ${kind.name} was built`);
    }
    const entry = {
      protocol: layerProtocol,
      signature: signatureOf(kind.name),
      url: downloadOf(kind.name),
    };
    for (const target of kind.targets) found[target] = entry;
    said.push(`layer (speaks ${layerProtocol})  ${kind.name}  ${kind.targets.join(", ")}`);
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

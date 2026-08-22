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
 * nothing is listed for `.deb` or `.rpm`, the app never offers those an update
 * mark at all (see `src-tauri/src/update.rs`), and the lookup falls through to
 * nothing rather than to the wrong file.
 *
 * macOS is the one platform listed twice. One universal build serves both
 * processors, but the updater asks as the machine it is running on, so both
 * names have to point at the same download.
 *
 * ## Why every one of them is required
 *
 * A missing key is not a smaller release, it is a platform that silently never
 * updates again — nobody would find out until the version after next. So this
 * refuses to write a document it cannot fill.
 *
 * Usage: node scripts/update-manifest.mjs <directory> <tag>
 */

import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** The name the app is pointed at, in `plugins > updater > endpoints`. */
const MANIFEST = "latest.json";

/**
 * Which kind of copy each bundle replaces.
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

// Actions names the repository; anywhere else this is a repository with one
// place to be released from, which is where the app is pointed.
const repository = process.env.GITHUB_REPOSITORY || "sasaki-s-sci/totex";
const version = tag.replace(/^v/, "");

const platforms = {};
const files = readdirSync(directory).sort();

for (const name of files) {
  if (name.endsWith(".sig")) continue;
  const kind = KINDS.find((candidate) => name.endsWith(candidate.suffix));
  if (!kind) continue;

  // The signature is what the app checks the download against, and it is the
  // whole reason a stolen release page cannot hand anybody a different binary.
  let signature;
  try {
    signature = readFileSync(join(directory, `${name}.sig`), "utf8").trim();
  } catch {
    fail(`${name} has no signature beside it — the build was not signed`);
  }

  const url = `https://github.com/${repository}/releases/download/${tag}/${encodeURIComponent(name)}`;
  for (const target of kind.targets) {
    if (platforms[target]) {
      fail(`two downloads claim ${target}: ${platforms[target].name} and ${name}`);
    }
    platforms[target] = { name, signature, url };
  }
}

const wanted = KINDS.flatMap((kind) => kind.targets);
const missing = wanted.filter((target) => !platforms[target]);
if (missing.length > 0) {
  fail(`nothing to update ${missing.join(", ")} with`);
}

const manifest = {
  version,
  pub_date: new Date().toISOString(),
  platforms: Object.fromEntries(
    // `name` was only ever for the error messages above; the app reads the two.
    wanted.map((target) => [
      target,
      { signature: platforms[target].signature, url: platforms[target].url },
    ]),
  ),
};

const out = join(directory, MANIFEST);
writeFileSync(out, `${JSON.stringify(manifest, null, 2)}\n`);
process.stdout.write(`${out}\n`);
for (const target of wanted) process.stdout.write(`  ${target}  ${platforms[target].name}\n`);

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

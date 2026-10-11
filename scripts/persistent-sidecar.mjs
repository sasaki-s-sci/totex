/**
 * Builds the program that holds the terminals, and puts it where the bundler
 * looks for a sidecar.
 *
 * `totex-persistent` is a crate of its own beside the app -- see
 * src-tauri/persistent/src/lib.rs -- and `tauri build` does not build it: it builds
 * the app. What it will do is carry a binary it is pointed at into every
 * bundle, beside the app's own, under `bundle.externalBin`; and what it wants
 * for that is the file under `src-tauri/binaries/`, named with the target
 * triple it was built for. This is the step that puts it there.
 *
 * Not in `tauri.conf.json`, on purpose. A sidecar named there is checked for
 * by every `cargo build` of the app, including `cargo test` and `cargo check`,
 * which would then all fail until this had been run. So the name is passed to
 * `tauri build` on the command line instead -- see the Taskfile and
 * .github/workflows/build.yml -- and a plain cargo build knows nothing of it.
 *
 * Without `--target`, the program is built for this machine and left in
 * `target/<profile>/` beside the app's own development binary, which is where
 * the app looks for it first -- see src-tauri/src/persistent.rs.
 *
 * A Windows build carries a second copy of the same program, built for Linux:
 * what runs inside a WSL distribution to ask about the agents there from
 * where they are, rather than across whatever networking the distribution
 * has. It is built here for x86_64-unknown-linux-musl, so that it runs in any
 * distribution whatever its libc -- or, where `TOTEX_WSL_HELPER` names one
 * already built, that one is taken instead. That is how CI does it: a Windows
 * runner has no C compiler for Linux, and the C in `ring` needs one, so an
 * Ubuntu job builds it and hands it over -- see .github/workflows/build.yml.
 * It lands under `binaries/` for the bundler and, without `--target`, beside
 * the development binary too.
 *
 * What the bundler is to carry is written to `binaries/bundle.json`, which
 * `tauri build --config` is pointed at: the program always, the Linux copy
 * where there is one. A build in CI without the Linux copy fails; anywhere
 * else it goes on without one, and only WSL monitoring of codex and opencode
 * is missing from what it makes.
 *
 * Usage: node scripts/persistent-sidecar.mjs [--release] [--target <triple>]
 */

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const release = args.includes("--release");
const targeted = args.indexOf("--target");
const target = targeted >= 0 ? args[targeted + 1] : null;
if (targeted >= 0 && !target) {
  fail("usage: node scripts/persistent-sidecar.mjs [--release] [--target <triple>]");
}

const manifest = join("src-tauri", "Cargo.toml");
const profile = release ? "release" : "debug";
const binaries = join("src-tauri", "binaries");
mkdirSync(binaries, { recursive: true });

if (target === "universal-apple-darwin") {
  // One download for both kinds of Mac, the same way the app is built: each
  // half on its own, glued together. The bundler is handed the glued one under
  // the universal name and the halves under their own, which is every name it
  // has been known to ask for.
  const halves = ["aarch64-apple-darwin", "x86_64-apple-darwin"].map((half) => {
    const built = build(half);
    copyFileSync(built, join(binaries, `totex-persistent-${half}`));
    return built;
  });
  const glued = join(binaries, "totex-persistent-universal-apple-darwin");
  execFileSync("lipo", ["-create", "-output", glued, ...halves], { stdio: "inherit" });
  process.stdout.write(`${glued}\n`);
} else {
  const built = build(target);
  const named = join(binaries, `totex-persistent-${target ?? host()}${exe(target)}`);
  copyFileSync(built, named);
  process.stdout.write(`${named}\n`);
}

/** The name the Windows program looks for beside itself -- `WSL_HELPER` in src-tauri/persistent/src/lib.rs. */
const HELPER = "totex-persistent-linux";
const HELPER_TARGET = "x86_64-unknown-linux-musl";

const bundle = { externalBin: ["binaries/totex-persistent"] };
const windows = target ? target.includes("windows") : process.platform === "win32";
if (windows) {
  const helper = linuxHelper();
  if (helper) {
    copyFileSync(helper, join(binaries, HELPER));
    if (!target) copyFileSync(helper, join("src-tauri", "target", profile, HELPER));
    // Beside the app in the install directory, which is where a Windows
    // bundle puts its resources and where src-tauri/src/persistent.rs looks.
    bundle.resources = { [`binaries/${HELPER}`]: HELPER };
    process.stdout.write(`${join(binaries, HELPER)}\n`);
  } else if (process.env.CI) {
    fail(`a Windows build in CI must carry ${HELPER}: set TOTEX_WSL_HELPER`);
  } else {
    process.stderr.write(
      `warning: building without ${HELPER}; WSL agents are monitored only through claude\n`,
    );
  }
}
writeFileSync(join(binaries, "bundle.json"), `${JSON.stringify({ bundle })}\n`);

/** Builds the program for one target, or for this machine, and says where it is. */
function build(triple) {
  const flags = ["build", "--manifest-path", manifest, "-p", "totex-persistent"];
  if (process.env.CI) flags.push("--locked", "--timings");
  if (release) flags.push("--release");
  if (triple) flags.push("--target", triple);
  execFileSync("cargo", flags, { stdio: "inherit" });
  const dir = triple
    ? join("src-tauri", "target", triple, profile)
    : join("src-tauri", "target", profile);
  return join(dir, `totex-persistent${exe(triple)}`);
}

/** The Linux copy of the program: the one named, or one built here, or none where this machine cannot. */
function linuxHelper() {
  const named = process.env.TOTEX_WSL_HELPER;
  if (named) return named;
  try {
    return build(HELPER_TARGET);
  } catch {
    if (process.env.CI) fail(`could not build ${HELPER} for ${HELPER_TARGET}`);
    return null;
  }
}

/** The triple this machine's compiler builds for when it is not told one. */
function host() {
  const said = execFileSync("rustc", ["-vV"]).toString();
  const found = /^host: (\S+)$/m.exec(said);
  if (!found) fail("rustc did not say which machine this is");
  return found[1];
}

/** What a program is called on the machine it is for. */
function exe(triple = null) {
  const windows = triple ? triple.includes("windows") : process.platform === "win32";
  return windows ? ".exe" : "";
}

function fail(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

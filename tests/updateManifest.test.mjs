import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const script = new URL("../scripts/update-manifest.mjs", import.meta.url);

test("release metadata uses the host identity from the actual ephemeral artifact", () => {
  const home = mkdtempSync(join(tmpdir(), "totex-manifest-"));
  try {
    const contents = join(home, "contents");
    mkdirSync(contents);
    const contract = "a".repeat(64);
    writeFileSync(
      join(contents, "ephemeral.json"),
      JSON.stringify({ schema: 2, version: pkg.version, contract }),
    );
    execFileSync("tar", ["-czf", join(home, "front.tar.gz"), "-C", contents, "."]);
    for (const name of [
      "windows-setup.exe",
      "windows.msi",
      "linux.AppImage",
      "mac.app.tar.gz",
      "totex-windows-x86_64.exe",
    ]) {
      writeFileSync(join(home, name), "fixture");
      writeFileSync(join(home, `${name}.sig`), "signature");
    }
    writeFileSync(join(home, "front.tar.gz.sig"), "signature");
    execFileSync(process.execPath, [fileURLToPath(script), home, `v${pkg.version}`], {
      stdio: "pipe",
    });
    const manifest = JSON.parse(readFileSync(join(home, "latest.json"), "utf8"));
    assert.equal(manifest.front.runtime, contract);
    assert.equal(manifest.front.needs, pkg.frontContract);
    assert.equal(manifest.version, pkg.version);
    assert.equal(Object.keys(manifest.platforms).length, 5);
    writeFileSync(
      join(contents, "ephemeral.json"),
      JSON.stringify({ schema: 2, version: "999.0.0", contract }),
    );
    execFileSync("tar", ["-czf", join(home, "front.tar.gz"), "-C", contents, "."]);
    assert.throws(() =>
      execFileSync(process.execPath, [fileURLToPath(script), home, `v${pkg.version}`], {
        stdio: "pipe",
      }),
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

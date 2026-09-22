import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve, win32 } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { contractOrder, shellContract, shellContractFiles } from "../scripts/ephemeral-build.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const list = JSON.parse(readFileSync(join(root, "scripts/shell-contract.json"), "utf8"));

test("the shared list is exactly what the contract hash reads", () => {
  const names = shellContractFiles(root);
  const listed = (name) =>
    list.files.includes(name) ||
    list.directories.some((directory) => name.startsWith(`${directory}/`));
  for (const file of list.files) assert.ok(names.includes(file), `missing ${file}`);
  for (const directory of list.directories) {
    assert.ok(
      names.some((name) => name.startsWith(`${directory}/`)),
      `empty ${directory}`,
    );
  }
  // The list names itself, so widening or narrowing the contract changes it.
  assert.ok(names.includes("scripts/shell-contract.json"));
  for (const name of names) {
    assert.ok(listed(name), `unlisted ${name}`);
    assert.doesNotMatch(name, /\/tests\/|\/tests\.rs$/);
  }
});

/** A minimal tree carrying one file of every kind the hash treats differently. */
function tree() {
  const base = mkdtempSync(join(tmpdir(), "totex-contract-"));
  const put = (path, text) => {
    mkdirSync(dirname(resolve(base, path)), { recursive: true });
    writeFileSync(resolve(base, path), text);
  };
  put(
    "scripts/shell-contract.json",
    JSON.stringify({
      directories: ["src-tauri/src"],
      files: [
        "index.html",
        "scripts/shell-contract.json",
        "src-tauri/Cargo.toml",
        "src-tauri/Cargo.lock",
      ],
    }),
  );
  put("src-tauri/src/lib.rs", "fn main() {}\n");
  put("index.html", "<!doctype html>\n");
  put("src-tauri/Cargo.toml", '[package]\nname = "totex"\nversion = "1.2.3"\n');
  put("src-tauri/Cargo.lock", 'name = "totex"\nversion = "1.2.3"\n');
  put("src-tauri/tauri.conf.json", '{"version":"1.2.3"}');
  put("package.json", '{"version":"1.2.3","frontContract":7}');
  put("node_modules/@tauri-apps/api/package.json", '{"version":"2.11.1"}');
  put("src/App.tsx", "export const App = () => null;\n");
  return { base, put };
}

test("only a listed file moves the contract, and never a release number", () => {
  const { base, put } = tree();
  const first = shellContract(base);
  put("src/App.tsx", "export const App = () => undefined;\n");
  put("src-tauri/src/tests.rs", "#[test]\nfn reaches() {}\n");
  put("src-tauri/src/ask/tests/mod.rs", "#[test]\nfn reaches() {}\n");
  assert.equal(shellContract(base), first, "unlisted and test sources stay out");
  put("src-tauri/Cargo.toml", '[package]\nname = "totex"\nversion = "9.9.9"\n');
  put("src-tauri/Cargo.lock", 'name = "totex"\nversion = "9.9.9"\n');
  put("src-tauri/tauri.conf.json", '{"version":"9.9.9"}');
  put("package.json", '{"version":"9.9.9","frontContract":7}');
  assert.equal(shellContract(base), first, "release numbers are normalised away");
  put("src-tauri/src/lib.rs", "fn main() {\n    run();\n}\n");
  const second = shellContract(base);
  assert.notEqual(second, first, "a listed source moves it");
  put("package.json", '{"version":"9.9.9","frontContract":8}');
  const third = shellContract(base);
  assert.notEqual(third, second, "the frontend contract moves it");
  put("scripts/shell-contract.json", JSON.stringify({ directories: [], files: ["index.html"] }));
  assert.notEqual(shellContract(base), third, "editing the list moves it");
});

test("the order is the same wherever it is built", () => {
  const names = ["index.html", "src-tauri/Cargo.lock", "src-tauri/src/lib.rs", "src/shell/main.ts"];
  // As windows-latest hands them over: a walked directory with `/`, a named file with `\`.
  const windows = names.map((name) =>
    name.startsWith("src-tauri/src/") ? `D:/r/${name}` : `D:\\r\\${name.replaceAll("/", "\\")}`,
  );
  assert.deepEqual(contractOrder("D:\\r", windows, win32), names);
  assert.deepEqual(
    contractOrder(
      "/r",
      names.map((name) => `/r/${name}`),
      posix,
    ),
    names,
  );
});

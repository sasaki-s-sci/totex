import { cpSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";

// Build a real second frontend with different executable code and the identical shell.
const root = fileURLToPath(new URL("..", import.meta.url));
const next = mkdtempSync(join(tmpdir(), "totex-shell-next-"));
for (const name of [
  "src",
  "src-tauri",
  "scripts",
  "package.json",
  "pnpm-lock.yaml",
  "index.html",
  "front.html",
  "vite.config.ts",
  "tsconfig.json",
]) {
  cpSync(join(root, name), join(next, name), {
    recursive: true,
    filter: (path) => !path.split("/").includes("target"),
  });
}
symlinkSync(join(root, "node_modules"), join(next, "node_modules"), "dir");
const pkg = JSON.parse(readFileSync(join(next, "package.json"), "utf8"));
pkg.version = "99.0.1";
writeFileSync(join(next, "package.json"), JSON.stringify(pkg));
const entry = join(next, "src/main.tsx");
writeFileSync(
  entry,
  `${readFileSync(entry, "utf8")}\ndocument.documentElement.dataset.frontRevision = "next";\n`,
);
const state = join(next, "src/shell/state.ts");
writeFileSync(
  state,
  `${readFileSync(state, "utf8")}\n// Frontend handoff helpers can evolve without replacing the shell.\n`,
);
await build({
  root: next,
  logLevel: "warn",
  build: { outDir: "/tmp/totex-shell-next-dist", emptyOutDir: true },
});
const original = JSON.parse(readFileSync(join(root, "dist/ephemeral.json"), "utf8"));
const candidate = JSON.parse(readFileSync("/tmp/totex-shell-next-dist/ephemeral.json", "utf8"));
if (candidate.contract !== original.contract || candidate.viewsContract === original.viewsContract)
  throw new Error("The fixture must change frontend code without changing the shell");
console.log("Built /tmp/totex-shell-next-dist (same shell, different frontend)");

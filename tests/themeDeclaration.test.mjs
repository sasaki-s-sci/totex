import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { DEFAULT_STYLE, NO_EFFECTS, readDeclaration } from "../src/theme/declaration.ts";

const BUILTIN = new URL("../src/theme/builtin/", import.meta.url);

test("every built-in is a valid declaration whose file name says its id and kind", () => {
  for (const file of readdirSync(BUILTIN).filter((name) => name.endsWith(".json"))) {
    const read = readDeclaration(JSON.parse(readFileSync(new URL(file, BUILTIN), "utf8")));
    assert.ok(read.ok, `${file}: ${read.error}`);
    const [id, kind] = file.replace(/\.json$/, "").split(/\.(?=[a-z]+$)/);
    assert.equal(`${read.value.id}.${read.value.kind}`, `${id}.${kind}`, file);
  }
});

const scheme = {
  ground: "#000",
  surface: "#111",
  edge: "#222",
  ink: "#fff",
  inkMuted: "#aaa",
  accent: "#00f",
  accentAlt: "#f0f",
  added: "#0f0",
  changed: "#fa0",
  removed: "#f00",
};

test("colours are refused whole when a key is missing, with the path named", () => {
  const { ink: _, ...partial } = scheme;
  const read = readDeclaration({ kind: "colors", id: "x", light: scheme, dark: partial });
  assert.deepEqual(read, { ok: false, error: "dark.ink must be a #hex colour" });
});

test("a terminal block must carry all sixteen colours", () => {
  const read = readDeclaration({
    kind: "colors",
    id: "x",
    light: scheme,
    dark: { ...scheme, terminal: { black: "#000" } },
  });
  assert.equal(read.ok, false);
  assert.match(read.error, /^dark\.terminal\.red/);
});

test("style and effects fill what they leave out from the neutral base", () => {
  const style = readDeclaration({ kind: "style", id: "s", font: { size: 15 } });
  assert.deepEqual(style.value, {
    ...DEFAULT_STYLE,
    id: "s",
    name: "s",
    font: { ...DEFAULT_STYLE.font, size: 15 },
  });

  const effects = readDeclaration({ kind: "effects", id: "e", wave: { period: 6 } });
  assert.deepEqual(effects.value, {
    ...NO_EFFECTS,
    id: "e",
    name: "e",
    wave: { ...NO_EFFECTS.wave, enabled: true, period: 6 },
  });
});

test("out-of-range and unknown values are refused", () => {
  assert.equal(readDeclaration({ kind: "style", id: "s", radius: 99 }).ok, false);
  assert.equal(
    readDeclaration({ kind: "effects", id: "e", window: { material: "glass" } }).ok,
    false,
  );
  assert.equal(readDeclaration({ kind: "effects", id: "e", window: { opacity: 2 } }).ok, false);
  assert.equal(readDeclaration({ kind: "palette", id: "p" }).ok, false);
  assert.equal(readDeclaration({ kind: "style", id: "has space" }).ok, false);
});

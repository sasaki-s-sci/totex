import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS, legacySettings, settingsFrom } from "../src/lib/appSettingsModel.ts";

test("migrates all existing user preferences, including line size one", () => {
  const values = new Map(
    Object.entries({
      "totex.mode": "dark",
      "totex.preset": "classic",
      "totex.language": "ja",
      "totex.reveal": "centre",
      "totex.follow": "on",
      "totex.mcp.serving": "yes",
      "totex.reading.size": "14",
      "totex.said": "on",
      "totex.said.face": "window",
      "totex.said.size": "1",
      "totex.said.lines": "3",
      "totex.said.width": "300",
      "totex.said.fit": "on",
    }),
  );
  assert.deepEqual(
    legacySettings((key) => values.get(key) ?? null),
    {
      theme: "dark",
      appearance: { colors: "classic", style: "default", effects: "none" },
      language: "ja",
      reveal: "centre",
      walkWrap: true,
      terminalSort: "createdWhere",
      follow: true,
      spareWorktree: true,
      backgroundGrid: false,
      gridStep: 24,
      gridSnap: false,
      groupGap: 2,
      historyLength: 3,
      historyFollow: false,
      mcpServing: true,
      fileTitle: "name",
      readingSize: 14,
      cliWheel: 100,
      graphWheel: 100,
      said: {
        showing: true,
        opacity: 100,
        face: "window",
        size: 1,
        lines: 3,
        width: 300,
        fitting: true,
      },
    },
  );
});

test("missing and invalid legacy preferences fall back to valid defaults", () => {
  assert.deepEqual(
    legacySettings(() => null),
    DEFAULT_SETTINGS,
  );
  assert.deepEqual(
    legacySettings(() => "NaN"),
    DEFAULT_SETTINGS,
  );
  assert.equal(legacySettings(() => "999").said.size, 20);
  assert.equal(legacySettings(() => "0.1").said.size, 1);
  // A preset saved as a whole JSON object is not an id; it falls back rather than carrying over.
  const preset = (value) => (key) => (key === "totex.preset" ? value : null);
  assert.equal(legacySettings(preset('{"name":"mine"}')).appearance.colors, "neon");
  assert.equal(legacySettings(preset("neon")).appearance.colors, "neon");
});

test("partial JSON uses defaults independently of migrated local preferences", () => {
  const settings = settingsFrom({ fileTitle: "path", said: { size: 1 } });
  assert.equal(settings.theme, "system");
  assert.equal(settings.fileTitle, "path");
  assert.deepEqual(settings.said, { ...DEFAULT_SETTINGS.said, size: 1 });
});

test("a partial appearance keeps the other layers at their defaults", () => {
  assert.deepEqual(settingsFrom({}).appearance, DEFAULT_SETTINGS.appearance);
  assert.deepEqual(settingsFrom({ appearance: { colors: "mine" } }).appearance, {
    colors: "mine",
    style: "default",
    effects: "none",
  });
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS, legacySettings, settingsFrom } from "../src/lib/appSettingsModel.ts";

test("migrates the user preferences that survive, reading the reading size", () => {
  const values = new Map(
    Object.entries({
      "totex.mode": "dark",
      "totex.preset": "classic",
      "totex.language": "ja",
      "totex.reveal": "centre",
      "totex.follow": "on",
      "totex.mcp.serving": "yes",
      "totex.reading.size": "14",
    }),
  );
  assert.deepEqual(
    legacySettings((key) => values.get(key) ?? null),
    {
      monitor: DEFAULT_SETTINGS.monitor,
      resume: DEFAULT_SETTINGS.resume,
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
      cliMarkSize: 11,
      folderMarkSize: 15,
      groupGap: 2,
      canvasAlign: "terminal",
      historyLength: 3,
      historyFollow: false,
      mcpServing: true,
      terminalUsage: false,
      fileTitle: "name",
      readingSize: 14,
      undoDepth: 200,
      cliWheel: 100,
      graphWheel: 10,
      pageText: 100,
      terminalText: 100,
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
  assert.equal(legacySettings(() => "999").readingSize, 20);
  assert.equal(legacySettings(() => "0.1").readingSize, 8);
  // A preset saved as a whole JSON object is not an id; it falls back rather than carrying over.
  const preset = (value) => (key) => (key === "totex.preset" ? value : null);
  assert.equal(legacySettings(preset('{"name":"mine"}')).appearance.colors, "neon");
  assert.equal(legacySettings(preset("neon")).appearance.colors, "neon");
});

test("partial JSON uses defaults independently of migrated local preferences", () => {
  const settings = settingsFrom({ fileTitle: "path", monitor: { text: "none" } });
  assert.equal(settings.theme, "system");
  assert.equal(settings.fileTitle, "path");
  assert.equal(settings.monitor.text, "none");
  assert.equal(settingsFrom({ monitor: { text: "llm" } }).monitor.text, "agent");
});

test("a partial appearance keeps the other layers at their defaults", () => {
  assert.deepEqual(settingsFrom({}).appearance, DEFAULT_SETTINGS.appearance);
  assert.deepEqual(settingsFrom({ appearance: { colors: "mine" } }).appearance, {
    colors: "mine",
    style: "default",
    effects: "none",
  });
});

test("monitor feature patches preserve independent defaults", () => {
  const settings = settingsFrom({
    monitor: { enabled: true, features: { estimate: true, agents: false } },
  });
  assert.equal(settings.monitor.enabled, true);
  assert.equal(settings.monitor.features.status, true);
  assert.equal(settings.monitor.features.estimate, true);
  assert.equal(settings.monitor.features.agents, false);
  assert.equal(DEFAULT_SETTINGS.monitor.enabled, false);
  assert.equal(DEFAULT_SETTINGS.monitor.features.agents, true);
});

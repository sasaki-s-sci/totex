import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_SETTINGS, legacySettings, settingsFrom } from "../src/lib/appSettingsModel.ts";

test("migrates all existing user preferences, including line size one", () => {
  const values = new Map(
    Object.entries({
      "totex.mode": "dark",
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
      language: "ja",
      reveal: "centre",
      follow: true,
      mcpServing: true,
      fileTitle: "name",
      readingSize: 14,
      said: { showing: true, face: "window", size: 1, lines: 3, width: 300, fitting: true },
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
});

test("partial JSON uses defaults independently of migrated local preferences", () => {
  const settings = settingsFrom({ fileTitle: "path", said: { size: 1 } });
  assert.equal(settings.theme, "system");
  assert.equal(settings.fileTitle, "path");
  assert.deepEqual(settings.said, { ...DEFAULT_SETTINGS.said, size: 1 });
});

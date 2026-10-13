import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeMonitor } from "../src/lib/appSettingsModel.ts";
import { agentCounts, estimateMinutes } from "../src/monitor/model.ts";

test("estimates remain unknown without a positive finite estimate", () => {
  for (const seconds of [0, -1, NaN, Infinity])
    assert.equal(estimateMinutes({ seconds, confidence: "low" }), null);
  assert.equal(estimateMinutes(null), null);
  assert.equal(estimateMinutes({ seconds: 61, confidence: "low" }), 2);
});
test("all observer and worker kinds count independently", () => {
  assert.deepEqual(
    agentCounts([
      { kind: "monitor" },
      { kind: "shell" },
      { kind: "subagent" },
      { kind: "subagent" },
      { kind: "background" },
    ]),
    { monitor: 1, shell: 1, subagent: 2, background: 1 },
  );
});
test("sequential settings edits preserve disabled features and command arguments", () => {
  const first = mergeMonitor({ enabled: true, args: ["--acp"], features: { agents: false } });
  const next = mergeMonitor(first, { model: "chosen", features: { estimate: true } });
  assert.equal(next.features.agents, false);
  assert.equal(next.features.estimate, true);
  assert.deepEqual(next.args, ["--acp"]);
  assert.equal(next.enabled, true);
});

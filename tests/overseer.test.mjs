import assert from "node:assert/strict";
import { test } from "node:test";
import { overseenReport } from "../src/lib/overseen.ts";
import { restored, sessionMeta, shellSession } from "../src/lib/session.ts";

function reborn(session) {
  return restored([
    { id: session.id, cwd: session.cwd, rows: 24, cols: 80, meta: sessionMeta(session) },
  ])[0];
}

test("an overseer's session keeps its mark through the meta kept beside the process", () => {
  const session = { ...shellSession("/work/a", "main"), overseer: true };
  assert.deepEqual(reborn(session), session);
});

test("a plain session's meta stays as it was before the overseer", () => {
  const session = shellSession("/work/b", "topic", true);
  assert.equal(sessionMeta(session), JSON.stringify({ branch: "topic", folder: true }));
  assert.deepEqual(reborn(session), session);
});

test("a meta naming the overseer as anything but true is not taken for one", () => {
  const [session] = restored([
    { id: "/w cli 9", cwd: "/w", rows: 24, cols: 80, meta: '{"branch":"x","overseer":"yes"}' },
  ]);
  assert.equal("overseer" in session, false);
});

test("a blank status is no report", () => {
  assert.equal(overseenReport(null), null);
  assert.equal(overseenReport("   "), null);
  assert.deepEqual(overseenReport(" waiting for permission "), {
    doing: "waiting for permission",
    steps: [],
    overseen: true,
  });
});

test("a terminal's overseer is its WSL distribution's, or this machine's", async () => {
  const { scopeOf } = await import("../src/lib/overseer.ts");
  assert.equal(scopeOf("\\\\wsl.localhost\\Ubuntu-24.04\\home\\a\\repo cli 3"), "Ubuntu-24.04");
  assert.equal(scopeOf("\\\\WSL$\\Debian\\srv overseer"), "Debian");
  assert.equal(scopeOf("//wsl.localhost/Ubuntu/home"), "Ubuntu");
  assert.equal(scopeOf("C:\\Users\\a\\repo cli 1"), null);
  assert.equal(scopeOf("/home/a/repo cli 1"), null);
  assert.equal(scopeOf("ssh://box/home/a cli 2"), null);
});

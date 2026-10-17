import assert from "node:assert/strict";
import { test } from "node:test";
import {
  agentOf,
  DEFAULT_RESUME,
  launchLine,
  mergeResume,
  parsePolicy,
  policyOf,
  readJobs,
  resumeLine,
  verdict,
} from "../src/resume/model.ts";

const base = policyOf(DEFAULT_RESUME);

test("a resume line is read over the defaults, guard command and all", () => {
  assert.deepEqual(
    parsePolicy("update=ask close=off within=30 guard=cmd:git rev-parse HEAD", base),
    {
      ...base,
      update: "ask",
      close: "off",
      within: 30,
      guard: "cmd:git rev-parse HEAD",
    },
  );
  assert.deepEqual(parsePolicy("crash=auto nonsense update=sometimes guard=none", base), {
    ...base,
    crash: "auto",
    guard: "none",
  });
  assert.equal(parsePolicy("within=1", base).within, 10);
});

test("settings a hand edit broke fall back field by field", () => {
  const merged = mergeResume({ update: "always", within: "x", guard: 3, agents: { codex: "" } });
  assert.equal(merged.update, DEFAULT_RESUME.update);
  assert.equal(merged.within, DEFAULT_RESUME.within);
  assert.equal(merged.guard, DEFAULT_RESUME.guard);
  assert.equal(merged.agents.codex, "codex");
  assert.equal(mergeResume({ guard: "cmd:make hash" }).guard, "cmd:make hash");
});

test("an agent is the first program a line names", () => {
  assert.equal(agentOf("claude --model opus"), "claude");
  assert.equal(agentOf("FOO=1 /usr/bin/codex"), "codex");
  assert.equal(agentOf("opencode.exe"), "opencode");
  assert.equal(agentOf("npm run claude"), null);
  assert.equal(agentOf("claude\nclaude"), null);
});

test("claude is started on a conversation of totex's choosing", () => {
  assert.deepEqual(
    launchLine("claude --model opus 'fix it'", () => "u-1"),
    { line: "claude --session-id u-1 --model opus 'fix it'", session: "u-1" },
  );
  assert.deepEqual(
    launchLine("claude --resume abc", () => "u-1"),
    {
      line: "claude --resume abc",
      session: "abc",
    },
  );
  assert.deepEqual(
    launchLine("claude -c", () => "u-1"),
    { line: "claude -c", session: null },
  );
  assert.deepEqual(
    launchLine("codex -m o3", () => "u-1"),
    { line: "codex -m o3", session: null },
  );
  assert.deepEqual(
    launchLine("my_cli watch docs", () => "u-1"),
    {
      line: "my_cli watch docs",
      session: null,
    },
  );
});

test("an agent resumes its conversation with its options and without its first prompt", () => {
  const claude = {
    line: "claude --session-id u-1 --model opus 'fix it'",
    agent: "claude",
    session: "u-1",
  };
  assert.equal(resumeLine(claude, null), "claude --model opus --resume u-1");
  assert.equal(resumeLine(claude, "go on"), "claude --model opus --resume u-1 'go on'");

  const codex = { line: "codex -m o3 --yolo 'fix it'", agent: "codex", session: "c-9" };
  assert.equal(resumeLine(codex, null), "codex resume -m o3 --yolo c-9");
  assert.equal(
    resumeLine({ ...codex, session: null }, "it's on"),
    "codex resume -m o3 --yolo --last 'it'\\''s on'",
  );

  const opencode = { line: "opencode -m x/y", agent: "opencode", session: null };
  assert.equal(resumeLine(opencode, "go"), "opencode -m x/y --continue --prompt go");
  assert.equal(
    resumeLine(
      { line: "opencode --prompt 'fix it' -s s-1", agent: "opencode", session: null },
      null,
    ),
    "opencode --session s-1",
  );

  assert.equal(
    resumeLine({ line: "my_cli watch docs", agent: null, session: null }, "go"),
    "my_cli watch docs",
  );
});

test("a lost job runs again only when nothing about it is in doubt", () => {
  const at = 1_000_000;
  const job = {
    lost: { why: "update", at },
    policy: base,
    seenAt: at - 1000,
    fingerprint: "git:a",
  };
  assert.deepEqual(verdict(job, at, "git:a"), { act: "auto", doubts: [] });
  assert.deepEqual(verdict(job, at, "git:b"), { act: "ask", doubts: ["changed"] });
  assert.deepEqual(verdict(job, at, "failed"), { act: "ask", doubts: ["unchecked"] });
  assert.deepEqual(verdict(job, at, "missing"), { act: "drop", doubts: [] });
  assert.deepEqual(verdict({ ...job, seenAt: at - 700_000 }, at, "git:a"), {
    act: "ask",
    doubts: ["stale"],
  });
  // Lost without a word is a crash, which is offered.
  assert.equal(verdict({ ...job, lost: null }, at, "git:a").act, "ask");
  // A closed terminal is offered while it is recent, then let go.
  const closed = { ...job, lost: { why: "close", at } };
  assert.equal(verdict(closed, at, "git:a").act, "ask");
  assert.equal(verdict({ ...closed, seenAt: at - 700_000 }, at, "git:a").act, "drop");
  assert.equal(verdict({ ...job, policy: { ...base, update: "off" } }, at, "git:a").act, "drop");
});

test("the kept document reads back only what looks like a job", () => {
  const job = { id: "a", cwd: "/x", line: "claude", policy: base };
  assert.deepEqual(readJobs({ jobs: [job, { id: 1 }, null] }), [job]);
  assert.deepEqual(readJobs(null), []);
});

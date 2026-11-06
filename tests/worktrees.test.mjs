import assert from "node:assert/strict";
import { test } from "node:test";
import { worktreeBranch } from "../src/lib/worktrees.ts";

test("worktree actions and terminal titles use the local branch name", () => {
  const tree = { branch: "refs/heads/feature/fix", shortHead: "a123456", name: "checkout" };
  assert.equal(worktreeBranch(tree), "feature/fix");
  assert.equal(worktreeBranch({ ...tree, branch: "main" }), "main");
  assert.equal(worktreeBranch({ ...tree, branch: null }), "a123456");
  assert.equal(worktreeBranch({ ...tree, branch: null, shortHead: null }), "checkout");
});

import assert from "node:assert/strict";
import test from "node:test";
import { newWorkBase } from "../src/lib/graph/history.ts";

test("new work starts from the default branch before the checked-out branch", () => {
  const main = { refName: "refs/heads/main", commit: "main-tip", isHead: false };
  const feature = { refName: "refs/heads/feature", commit: "feature-tip", isHead: true };
  assert.deepEqual(
    newWorkBase({ branches: [feature, main], defaultBranch: main.refName, commits: [] }),
    { branch: main, commit: "main-tip" },
  );
});

test("new work falls back to the checked-out branch, then the newest commit", () => {
  const feature = { refName: "refs/heads/feature", commit: "feature-tip", isHead: true };
  const repository = { branches: [feature], defaultBranch: null, commits: [{ id: "newest" }] };
  assert.equal(newWorkBase(repository).commit, "feature-tip");
  assert.equal(newWorkBase({ ...repository, branches: [] }).commit, "newest");
  assert.equal(newWorkBase({ ...repository, branches: [], commits: [] }).commit, undefined);
});

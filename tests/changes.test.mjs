import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "vite";

const cacheDir = await mkdtemp(join(tmpdir(), "totex-changes-"));
const server = await createServer({
  configFile: false,
  cacheDir,
  server: { watch: null },
});
const { changeOf, changesOf } = await server.ssrLoadModule("/src/lib/changes.ts");
await server.close();
await rm(cacheDir, { recursive: true, force: true });

const status = (added, modified, deleted) => ({ added, modified, deleted });

test("a worktree takes the one colour its files agree on, and amber when they do not", () => {
  assert.equal(changeOf(status(0, 0, 0)), null);
  assert.equal(changeOf(status(2, 0, 0)), "added");
  assert.equal(changeOf(status(0, 0, 1)), "deleted");
  assert.equal(changeOf(status(0, 3, 0)), "modified");
  assert.equal(changeOf(status(1, 0, 1)), "modified");
});

function workspace() {
  return {
    root: "/w",
    warnings: [],
    repositories: [
      {
        id: "a",
        worktrees: [{ path: "/w/a" }, { path: "/w/a-feature" }],
      },
      { id: "b", worktrees: [{ path: "/w/b" }] },
      { id: "c", worktrees: [{ path: "/w/c" }] },
    ],
  };
}

test("the colour climbs from worktrees to their repository and on to the folder", () => {
  const statuses = new Map([
    ["/w/a", status(2, 0, 0)],
    ["/w/a-feature", status(0, 0, 1)],
    ["/w/b", status(0, 0, 0)],
    ["/w/c", status(1, 0, 0)],
  ]);
  const folders = [
    { kind: "folder", root: "/w", name: "w", repositories: ["a", "b"] },
    { kind: "folder", root: "/w/c", name: "c", repositories: ["c"] },
    { kind: "repository", root: "/w/c", name: "c", repositories: ["c"] },
  ];
  const changes = changesOf(workspace(), folders, statuses);

  assert.deepEqual(
    [...changes.worktrees],
    [
      ["/w/a", "added"],
      ["/w/a-feature", "deleted"],
      ["/w/c", "added"],
    ],
  );
  // Two worktrees that disagree make the repository amber; a clean one is left out.
  assert.deepEqual(
    [...changes.repositories],
    [
      ["a", "modified"],
      ["c", "added"],
    ],
  );
  // A folder answers for the repositories it lists; a repository standing as itself has no row.
  assert.deepEqual(
    [...changes.folders],
    [
      ["/w", "modified"],
      ["/w/c", "added"],
    ],
  );
});

test("nothing read yet colours nothing", () => {
  const changes = changesOf(
    workspace(),
    [{ kind: "folder", root: "/w", name: "w", repositories: ["a"] }],
    new Map(),
  );
  assert.equal(changes.worktrees.size, 0);
  assert.equal(changes.repositories.size, 0);
  assert.equal(changes.folders.size, 0);
});

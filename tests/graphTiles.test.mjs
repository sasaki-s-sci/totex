import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "vite";

const cacheDir = await mkdtemp(join(tmpdir(), "totex-graph-tiles-"));
const server = await createServer({
  configFile: false,
  cacheDir,
  server: { watch: null },
});
const { buildCommitGraph } = await server.ssrLoadModule("/src/lib/graph/build/index.ts");
await server.close();
await rm(cacheDir, { recursive: true, force: true });

const STEP = 24;
const CWD = "/home/a/repo";

function repository() {
  const commit = { id: "tip", parents: [] };
  return {
    id: "repo",
    name: "repo",
    path: CWD,
    gitDir: `${CWD}/.git`,
    bare: false,
    head: "tip",
    headDetached: false,
    defaultBranch: "refs/heads/main",
    remotes: [],
    commits: [commit],
    worktrees: [{ id: "wt", path: CWD, head: "tip" }],
    historyTruncated: false,
    branches: [
      {
        id: "main",
        name: "main",
        logicalName: "main",
        refName: "refs/heads/main",
        kind: "local",
        remote: null,
        commit: commit.id,
        isHead: true,
        checkedOutIn: ["wt"],
        upstream: null,
      },
    ],
  };
}

function build(sessions, tiles = new Map()) {
  return buildCommitGraph({
    workspace: { root: CWD, repositories: [repository()], warnings: [] },
    folders: [{ kind: "repository", root: CWD, name: "repo", repositories: ["repo"] }],
    visible: new Map(),
    opened: new Map(),
    closed: new Set(),
    tiles,
    step: STEP,
    sessions,
    showing: null,
    reports: new Map(),
    reaching: null,
    places: new Map(),
  });
}

const session = (id) => ({ id, cwd: CWD, branch: "main", folder: false });
const tilesOf = (graph) => graph.nodes.filter((node) => node.type === "tile");

test("a plain terminal stands a tile of its grid steps, and tiles beneath one another", () => {
  const graph = build([session("a"), session("b")]);
  const [first, second] = tilesOf(graph).sort((x, y) => x.position.y - y.position.y);

  assert.equal(tilesOf(graph).length, 2);
  assert.equal(first.data.units, 3);
  assert.equal(first.style.height, 3 * STEP);
  // The second starts below the first ends: stacked, not overlapping.
  assert.ok(second.position.y >= first.position.y + first.style.height);
});

test("a tile is fixed at its default length, and only grows from it", () => {
  const graph = build([session("a")], new Map([["a", 1]]));
  assert.equal(tilesOf(graph)[0].data.units, 3);

  const grown = build([session("a")], new Map([["a", 40]]));
  const [tile] = tilesOf(grown);
  assert.equal(tile.data.units, 12);
  assert.equal(tile.style.height, 12 * STEP);
});

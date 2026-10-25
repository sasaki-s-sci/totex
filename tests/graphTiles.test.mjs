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
const { endsOf } = await server.ssrLoadModule("/src/canvas/lines/path.ts");
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

function build(sessions, tiles = new Map(), extra = {}, previous) {
  return buildCommitGraph(
    {
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
      ...extra,
    },
    previous,
  );
}

const session = (id) => ({ id, cwd: CWD, branch: "main", folder: false });
const tilesOf = (graph) => graph.nodes.filter((node) => node.type === "tile");

test("a plain terminal defaults to two text rows, and tiles stack beneath one another", () => {
  const graph = build([session("a"), session("b")]);
  const [first, second] = tilesOf(graph).sort((x, y) => x.position.y - y.position.y);

  assert.equal(tilesOf(graph).length, 2);
  assert.equal(first.data.units, 2);
  assert.equal(first.style.height, 32);
  // The second starts below the first ends: stacked, not overlapping.
  assert.ok(second.position.y >= first.position.y + first.style.height);
});

test("a tile is fixed at its default length, and only grows from it", () => {
  const graph = build([session("a")], new Map([["a", 1]]));
  assert.equal(tilesOf(graph)[0].data.units, 2);
  assert.equal(tilesOf(graph)[0].style.height, 32);

  const resized = build([session("a")], new Map([["a", 3]]));
  assert.equal(tilesOf(resized)[0].style.height, 32 + STEP);

  const grown = build([session("a")], new Map([["a", 40]]));
  const [tile] = tilesOf(grown);
  assert.equal(tile.data.units, 12);
  assert.equal(tile.style.height, 32 + 10 * STEP);
});

test("session edges join without a gap in folders and open or folded repositories", () => {
  for (const extra of [
    {},
    { opened: new Map([["repo", false]]) },
    {
      workspace: { root: CWD, repositories: [], warnings: [] },
      folders: [{ kind: "folder", root: CWD, name: "repo", repositories: [] }],
    },
    { reports: new Map([["a", { doing: "working", steps: [] }]]) },
  ]) {
    const graph = build([session("a"), session("b")], new Map(), extra);
    const places = new Map(graph.nodes.map((node) => [node.id, node.position]));
    const lines = [...graph.reach, ...graph.bands.flatMap((band) => band.runs)].flatMap(
      (batch) => batch.parts,
    );
    for (const id of ["sessiona", "sessionb"]) {
      const incoming = lines.find((line) => line.to.node === id);
      const outgoing = lines.find((line) => line.from.node === id);
      assert.ok(incoming && outgoing, id);
      assert.deepEqual(endsOf(incoming, places).end, endsOf(outgoing, places).start);
    }
  }
});

test("card width changes update the measured node and graph extent", () => {
  const sessions = [session("a")];
  let previous;
  for (const width of [160, 220, 320, 420]) {
    const graph = build(sessions, new Map(), { cardWidth: width }, previous);
    const [tile] = tilesOf(graph);
    assert.equal(tile.style.width, width);
    if (previous) assert.ok(graph.extent.width > previous.extent.width);
    previous = graph;
  }
});

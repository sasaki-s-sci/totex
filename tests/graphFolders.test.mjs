import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "vite";

const cacheDir = await mkdtemp(join(tmpdir(), "totex-graph-folders-"));
const server = await createServer({
  configFile: false,
  cacheDir,
  server: { watch: null },
});
const { buildCommitGraph } = await server.ssrLoadModule("/src/lib/graph/build/index.ts");
const { folderId, groupKey } = await server.ssrLoadModule("/src/lib/graph/folders.ts");
await server.close();
await rm(cacheDir, { recursive: true, force: true });

function repository(id, path) {
  const commit = { id: "tip", parents: [] };
  return {
    id,
    name: id,
    path,
    gitDir: `${path}/.git`,
    bare: false,
    head: "tip",
    headDetached: false,
    defaultBranch: "refs/heads/main",
    remotes: [],
    commits: [commit],
    worktrees: [],
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
        checkedOutIn: [],
        upstream: null,
      },
    ],
  };
}

function build(workspace, folders, previous, sessions = []) {
  return buildCommitGraph(
    {
      workspace,
      folders,
      visible: new Map(),
      opened: new Map(),
      closed: new Set(),
      sessions,
      showing: null,
      asks: new Map(),
      reports: new Map(),
      reaching: null,
      places: new Map(),
    },
    previous,
  );
}

const folderNodes = (graph) => graph.nodes.filter((node) => node.type === "folder");
const bandNodes = (graph) => graph.nodes.filter((node) => node.type === "repository");

test("a folder graphed as a folder is one row with nothing scanned under it", () => {
  const graph = build({ root: "", repositories: [], warnings: [] }, [
    { kind: "folder", root: "/home/a", name: "a", repositories: [] },
  ]);

  const rows = folderNodes(graph);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].id, folderId("/home/a"));
  assert.equal(rows[0].data.kind, "folder");
  assert.equal(rows[0].data.name, "a");
  assert.equal(bandNodes(graph).length, 0);
  assert.equal(graph.bands.length, 0);
});

test("a repository graphed alone is its band, with no row above it and no line into it", () => {
  const repo = repository("repo", "/home/a/repo");
  const graph = build({ root: "/home/a/repo", repositories: [repo], warnings: [] }, [
    { kind: "repository", root: "/home/a/repo", name: "repo", repositories: ["repo"] },
  ]);

  assert.equal(folderNodes(graph).length, 0);
  assert.equal(graph.reach.length, 0);
  assert.equal(graph.holds.length, 0);

  const bands = bandNodes(graph);
  assert.equal(bands.length, 1);
  assert.equal(bands[0].data.repository, repo);
  assert.deepEqual(bands[0].position, { x: 0, y: 0 });
  assert.equal(graph.bands.length, 1);

  // The band is what the group is moved by.
  assert.equal(bands[0].draggable, true);
  assert.equal(
    graph.groups.get(groupKey({ kind: "repository", root: "/home/a/repo" })).node,
    "repo",
  );
});

test("a row is kept from the last draw while nothing about it changed", () => {
  const folders = [{ kind: "folder", root: "/home/a", name: "a", repositories: [] }];
  const empty = { root: "", repositories: [], warnings: [] };
  const first = build(empty, folders);
  const again = build(empty, folders, first);
  assert.equal(folderNodes(again)[0], folderNodes(first)[0]);
});

test("one directory graphed both ways is drawn both ways, each moved on its own", () => {
  const repo = repository("repo", "/home/a");
  repo.worktrees = [
    {
      id: "main-tree",
      path: "/home/a",
      name: "a",
      branch: "main",
      head: "tip",
      exists: true,
      bare: false,
    },
  ];
  repo.branches[0].checkedOutIn = ["main-tree"];
  const folders = [
    { kind: "folder", root: "/home/a", name: "a", repositories: [] },
    { kind: "repository", root: "/home/a", name: "a", repositories: ["repo"] },
  ];
  const sessions = [
    { id: "/home/a cli 1", cwd: "/home/a", branch: "a", folder: true },
    { id: "/home/a cli 2", cwd: "/home/a", branch: "main" },
  ];
  const graph = build(
    { root: "/home/a", repositories: [repo], warnings: [] },
    folders,
    undefined,
    sessions,
  );

  assert.equal(folderNodes(graph).length, 1);
  assert.equal(bandNodes(graph).length, 1);
  assert.equal(graph.groups.size, 2);

  // The terminal the folder's row opened stands by the row; the other is the branch's.
  const clis = graph.nodes.filter((node) => node.type === "cli");
  assert.equal(clis.length, 2);
  const byRow = clis.find((node) => node.data.session.folder);
  const byBranch = clis.find((node) => !node.data.session.folder);
  assert.equal(byRow.parentId ?? null, null);
  assert.equal(byBranch.parentId, "repo");
});

test("a branch and a folder nothing runs in are offered a terminal, and a repository a workspace", () => {
  const repo = repository("repo", "/home/a/repo");
  const workspace = { root: "/home/a/repo", repositories: [repo], warnings: [] };
  const folders = [
    { kind: "folder", root: "/home/b", name: "b", repositories: [] },
    { kind: "repository", root: "/home/a/repo", name: "repo", repositories: ["repo"] },
  ];

  const graph = build(workspace, folders);
  assert.deepEqual(
    graph.offers.map((offer) => [
      offer.data.kind,
      offer.data.branch ?? null,
      offer.parentId ?? null,
    ]),
    [
      ["open", "b", null],
      ["open", "main", "repo"],
      ["new", null, "repo"],
    ],
  );
  // Never among the canvas's own nodes: they are drawn on a key press.
  assert.equal(graph.nodes.filter((node) => node.type === "offer").length, 0);

  // The new workspace stands under the band, clear of every row's stack.
  const band = bandNodes(graph)[0];
  const fresh = graph.offers.find((offer) => offer.data.kind === "new");
  assert.ok(fresh.position.y >= Number(band.style.height));

  // Unchanged offers come back as themselves, so holding the keys over a rescan redraws nothing.
  const again = build(workspace, folders, graph);
  assert.deepEqual(
    again.offers.map((offer, at) => offer === graph.offers[at]),
    [true, true, true],
  );

  // A terminal in the folder takes its offer away and leaves the others.
  const running = build(workspace, folders, graph, [
    { id: "/home/b cli 1", cwd: "/home/b", branch: "b", folder: true },
  ]);
  assert.deepEqual(
    running.offers.map((offer) => offer.data.kind),
    ["open", "new"],
  );
});

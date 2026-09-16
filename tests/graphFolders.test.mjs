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
const { folderId } = await server.ssrLoadModule("/src/lib/graph/folders.ts");
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

function build(workspace, folders, previous) {
  return buildCommitGraph(
    {
      workspace,
      folders,
      visible: new Map(),
      opened: new Map(),
      closed: new Set(),
      sessions: [],
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

test("a repository graphed alone is its row and its band", () => {
  const repo = repository("repo", "/home/a/repo");
  const graph = build({ root: "/home/a/repo", repositories: [repo], warnings: [] }, [
    { kind: "repository", root: "/home/a/repo", name: "repo", repositories: ["repo"] },
  ]);

  const rows = folderNodes(graph);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].data.kind, "repository");
  assert.equal(rows[0].data.open, true);

  const bands = bandNodes(graph);
  assert.equal(bands.length, 1);
  assert.equal(bands[0].data.repository, repo);
  assert.equal(graph.bands.length, 1);
});

test("the kind is part of what keeps a row from the last draw", () => {
  const folders = [{ kind: "folder", root: "/home/a", name: "a", repositories: [] }];
  const empty = { root: "", repositories: [], warnings: [] };
  const first = build(empty, folders);
  const again = build(empty, folders, first);
  assert.equal(folderNodes(again)[0], folderNodes(first)[0]);

  const changed = build(
    { root: "/home/a", repositories: [repository("repo", "/home/a")], warnings: [] },
    [{ kind: "repository", root: "/home/a", name: "a", repositories: ["repo"] }],
    first,
  );
  assert.notEqual(folderNodes(changed)[0], folderNodes(first)[0]);
  assert.equal(folderNodes(changed)[0].data.kind, "repository");
});

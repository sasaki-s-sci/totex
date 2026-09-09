import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { createServer } from "vite";

const cacheDir = await mkdtemp(join(tmpdir(), "totex-graph-layout-"));
const server = await createServer({
  configFile: false,
  cacheDir,
  server: { watch: null },
});
const { prepare } = await server.ssrLoadModule("/src/lib/graph/layout.ts");
const { COMMIT_STEP, rowReach, branchPitch } =
  await server.ssrLoadModule("/src/lib/graph/model.ts");
await server.close();
await rm(cacheDir, { recursive: true, force: true });

function repository(names, commits = [{ id: "tip", parents: [] }]) {
  return {
    id: "repo",
    name: "repo",
    path: "/repo",
    remotes: [],
    defaultBranch: "refs/heads/main",
    commits,
    worktrees: [],
    branches: names.map((name, index) => ({
      id: name,
      name,
      logicalName: name,
      refName: `refs/heads/${name}`,
      kind: "local",
      remote: null,
      commit: commits[index % commits.length].id,
      isHead: index === 0,
      checkedOutIn: [],
      upstream: null,
    })),
  };
}

const middle = (node) => node.position.y + Number(node.style.height) / 2;

test("branch fans spread around the trunk for odd and even row counts", () => {
  for (const count of [1, 2, 3, 6, 9]) {
    const repo = repository(Array.from({ length: count }, (_, i) => `dev/${i}`));
    const graph = prepare(repo, undefined, new Map());
    const ys = graph.nodes.filter((n) => n.type === "head").map(middle);
    assert.equal(ys.length, count);
    assert.ok(Math.abs((Math.min(...ys) + Math.max(...ys)) / 2 - graph.trunk) <= COMMIT_STEP.y / 2);
    if (count > 1) {
      const junction = graph.nodes.find((n) => n.type === "junction");
      assert.equal(middle(junction), (Math.min(...ys) + Math.max(...ys)) / 2);
    }
  }
});

test("history lanes expand to both sides while the fold stays on the trunk", () => {
  const repo = repository(
    ["main", "side/a", "side/b"],
    [
      { id: "main", parents: ["root"] },
      { id: "a", parents: ["root"] },
      { id: "b", parents: ["root"] },
      { id: "root", parents: ["older"] },
      { id: "older", parents: [] },
    ],
  );
  for (const shown of [4, 5]) {
    const graph = prepare(repo, shown, new Map());
    const commits = graph.nodes.filter((n) => n.type === "commit");
    assert.equal(middle(commits[0]), graph.trunk);
    assert.ok(commits.some((n) => middle(n) < graph.trunk));
    assert.ok(commits.some((n) => middle(n) > graph.trunk));
    assert.ok(graph.data.label.y >= 0);
    assert.ok(graph.data.label.y + graph.data.label.height <= Math.min(...commits.map(middle)));
    const fold = graph.nodes.find((n) => n.type === "collapse");
    if (fold) assert.equal(middle(fold), graph.trunk);
  }
});

test("uneven terminal stacks remain balanced, spaced and inside the band", () => {
  const repo = repository(["dev/a", "dev/b", "dev/c"]);
  const counts = [7, 1, 2];
  repo.worktrees = repo.branches.map((branch, i) => {
    branch.checkedOutIn = [`wt${i}`];
    return { id: `wt${i}`, path: `/repo/${i}`, head: "tip" };
  });
  const graph = prepare(repo, undefined, new Map(counts.map((n, i) => [`/repo/${i}`, n])));
  const ys = graph.nodes.filter((n) => n.type === "head").map(middle);
  const top = ys[0] - rowReach(counts[0]);
  const bottom = ys[2] + rowReach(counts[2]);
  assert.ok(top >= 0);
  assert.ok(bottom <= graph.style.height);
  assert.ok(Math.abs((top + bottom) / 2 - graph.trunk) <= COMMIT_STEP.y / 2);
  for (let i = 1; i < ys.length; i++) {
    assert.ok(ys[i] - ys[i - 1] >= branchPitch(counts[i - 1], counts[i]));
  }
});

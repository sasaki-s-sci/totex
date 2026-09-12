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
const { junctionId } = await server.ssrLoadModule("/src/lib/graph/junctions.ts");
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

test("a knot pressed shut puts its branches away and takes a row of its own", () => {
  const repo = repository(["dev/a", "dev/b", "dev/c", "main", "side/x", "side/y"]);
  const open = prepare(repo, undefined, new Map());
  const shut = prepare(repo, undefined, new Map(), new Set([junctionId("repo", "dev")]));

  const heads = (graph) => graph.nodes.filter((n) => n.type === "head").map((n) => n.data.name);
  assert.deepEqual(heads(open), ["dev/a", "dev/b", "dev/c", "main", "side/x", "side/y"]);
  assert.deepEqual(heads(shut), ["main", "side/x", "side/y"]);

  // The knot stands in the column's own rhythm, on the row `dev/a` had, with
  // the rest closed up under it: the same pitch as between two branches.
  const knots = shut.nodes.filter((n) => n.type === "junction");
  const dev = knots.find((n) => n.data.prefix === "dev");
  const side = knots.find((n) => n.data.prefix === "side");
  assert.equal(dev.data.closed, true);
  assert.equal(side.data.closed, false);
  assert.equal(dev.data.members, 3);
  const main = shut.nodes.find((n) => n.type === "head" && n.data.name === "main");
  assert.equal(middle(main) - middle(dev), COMMIT_STEP.y);

  // The lines from the history still arrive at the shut knot, and nothing
  // leaves it. The branch column itself has not moved.
  const lines = [...shut.lines.strokes.flatMap((batch) => batch.parts), ...shut.lines.named];
  assert.ok(lines.some((line) => line.to.node === dev.id));
  assert.ok(!lines.some((line) => line.from.node === dev.id));
  const ringOf = (graph) => graph.nodes.find((n) => n.type === "head").position.x;
  assert.equal(ringOf(shut), ringOf(open));
  // And shutting is not a change to the width: the band is as wide as before.
  assert.equal(shut.style.width, open.style.width);
});

test("a branch being worked in stays drawn under a shut knot, and the knot takes no row", () => {
  const repo = repository(["dev/a", "dev/b", "dev/c", "main"]);
  repo.branches[1].checkedOutIn = ["wt1"];
  repo.worktrees = [{ id: "wt1", path: "/repo/1", head: "tip" }];
  const closed = new Set([junctionId("repo", "dev")]);
  const graph = prepare(repo, undefined, new Map([["/repo/1", 1]]), closed);

  const heads = graph.nodes.filter((n) => n.type === "head").map((n) => n.data.name);
  assert.deepEqual(heads, ["dev/b", "main"]);
  const dev = graph.nodes.find((n) => n.type === "junction");
  const b = graph.nodes.find((n) => n.type === "head" && n.data.name === "dev/b");
  assert.equal(middle(dev), middle(b));
  assert.equal(graph.nodes.filter((n) => n.type === "head").length, 2);
});

test("shutting a knot hides the knots gathered at it, and shutting one of those leaves the rest", () => {
  const names = ["dev/api/a", "dev/api/b", "dev/web/a", "dev/web/b", "ops/x", "ops/y"];
  const repo = repository(names);
  const knotsOf = (graph) =>
    graph.nodes
      .filter((n) => n.type === "junction")
      .map((n) => n.data.prefix)
      .sort();
  const headsOf = (graph) => graph.nodes.filter((n) => n.type === "head").map((n) => n.data.name);

  const open = prepare(repo, undefined, new Map());
  assert.deepEqual(knotsOf(open), ["dev", "dev/api", "dev/web", "ops"]);

  const outer = prepare(repo, undefined, new Map(), new Set([junctionId("repo", "dev")]));
  assert.deepEqual(knotsOf(outer), ["dev", "ops"]);
  assert.deepEqual(headsOf(outer), ["ops/x", "ops/y"]);

  const inner = prepare(repo, undefined, new Map(), new Set([junctionId("repo", "dev/api")]));
  assert.deepEqual(knotsOf(inner), ["dev", "dev/api", "dev/web", "ops"]);
  assert.deepEqual(headsOf(inner), ["dev/web/a", "dev/web/b", "ops/x", "ops/y"]);
  // The shut inner knot is seated where `dev/api/a` stood, and the outer knot
  // still stands half way between it and the knot that is left open.
  const api = inner.nodes.find((n) => n.type === "junction" && n.data.prefix === "dev/api");
  const webA = inner.nodes.find((n) => n.type === "head" && n.data.name === "dev/web/a");
  assert.equal(middle(webA) - middle(api), COMMIT_STEP.y);
  const dev = inner.nodes.find((n) => n.type === "junction" && n.data.prefix === "dev");
  const web = inner.nodes.find((n) => n.type === "junction" && n.data.prefix === "dev/web");
  assert.equal(middle(dev), (middle(api) + middle(web)) / 2);
});

test("a knot shut in another repository is nothing to this one", () => {
  const repo = repository(["dev/a", "dev/b", "main"]);
  const graph = prepare(repo, undefined, new Map(), new Set([junctionId("other", "dev")]));
  assert.equal(graph.nodes.filter((n) => n.type === "head").length, 3);
  assert.equal(graph.nodes.find((n) => n.type === "junction").data.closed, false);
});

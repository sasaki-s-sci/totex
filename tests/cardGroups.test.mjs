import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "vite";

const server = await createServer({ configFile: false, server: { watch: null } });
const { cardGroups } = await server.ssrLoadModule("/src/cards/groups.ts");
await server.close();

const worktree = (path, extra = {}) => ({ path, exists: true, bare: false, ...extra });
const repo = (id, paths) => ({ id, path: paths[0], worktrees: paths.map((p) => worktree(p)) });
const session = (id, cwd) => ({ id, cwd, branch: "main" });

test("worktrees share a repository group, nested repositories own their sessions", () => {
  const repositories = [repo("one", ["/repo", "/outside/topic"]), repo("nested", ["/repo/nested"])];
  const sessions = [
    session("a", "/repo/src"),
    session("b", "/outside/topic"),
    session("c", "/repo/nested/src"),
    session("d", "/repo-other"),
  ];
  const groups = cardGroups(repositories, [], sessions);
  assert.deepEqual(
    groups.map((group) => [
      group.repository?.id,
      group.cards.map((card) => [card.path, card.sessions.map((s) => s.id)]),
    ]),
    [
      [
        "one",
        [
          ["/repo", ["a"]],
          ["/outside/topic", ["b"]],
        ],
      ],
      ["nested", [["/repo/nested", ["c"]]]],
      [undefined, [["/repo-other", ["d"]]]],
    ],
  );
  assert.equal(
    groups.flatMap((group) => group.cards.flatMap((card) => card.sessions)).length,
    sessions.length,
  );
});

test("plain sessions group by exact folder and empty opened folders remain available", () => {
  const groups = cardGroups(
    [],
    [{ kind: "folder", root: "/empty" }],
    [session("a", "/folder"), session("b", "/folder"), session("c", "/folder/sub")],
  );
  assert.deepEqual(
    groups[0].cards.map((card) => [card.path, card.sessions.length]),
    [
      ["/empty", 0],
      ["/folder", 2],
      ["/folder/sub", 1],
    ],
  );
});

test("folder and git views of the same Windows checkout do not duplicate cards", () => {
  const groups = cardGroups(
    [repo("one", ["C:\\Repo"])],
    [{ kind: "folder", root: "c:/repo/" }],
    [session("a", "C:/REPO/sub")],
  );
  assert.equal(groups.length, 1);
  assert.equal(groups[0].cards.length, 1);
  assert.equal(groups[0].cards[0].sessions[0].id, "a");
});

test("SSH hosts stay separate and missing or bare worktrees do not offer shells", () => {
  const repository = repo("one", ["ssh://one/repo"]);
  repository.worktrees.push(
    worktree("/gone", { exists: false }),
    worktree("/bare", { bare: true }),
  );
  const groups = cardGroups(
    [repository],
    [],
    [session("a", "ssh://two/repo"), session("b", "/gone")],
  );
  assert.deepEqual(
    groups[0].cards.map((card) => card.path),
    ["ssh://one/repo"],
  );
  assert.deepEqual(
    groups[1].cards.map((card) => card.path),
    ["ssh://two/repo", "/gone"],
  );
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { readSeeds } from "../src/lib/graphed.ts";
import { sessionsInPlaces, underPlace } from "../src/lib/placeSessions.ts";

const session = (cwd, more = {}) => ({ id: cwd, cwd, branch: "main", ...more });
const repo = { path: "/projects/app", worktrees: [{ path: "/worktrees/feature" }] };

test("removing a repo covers all terminals and external worktrees without killing a sibling or overseer", () => {
  const matches = sessionsInPlaces([{ kind: "repository", root: repo.path }], [repo]);
  assert.equal(matches(session("/projects/app")), true);
  assert.equal(matches(session("/projects/app/src")), true);
  assert.equal(matches(session("/worktrees/feature/build")), true);
  assert.equal(matches(session("/projects/app-other")), false);
  assert.equal(matches(session("/worktrees/other")), false);
  assert.equal(matches(session("/projects/app", { overseer: true })), false);
});

test("folder deletion includes repositories beneath it and their worktrees", () => {
  const matches = sessionsInPlaces([{ kind: "folder", root: "/projects" }], [repo]);
  assert.equal(matches(session("/projects/notes", { folder: true })), true);
  assert.equal(matches(session("/worktrees/feature")), true);
  assert.equal(matches(session("/projects-other/app")), false);
});

test("ownership uses path components and platform casing", () => {
  assert.equal(underPlace("C:\\Projects\\App\\", "c:/projects/app/src"), true);
  assert.equal(underPlace("C:/projects/app", "c:/projects/app-two"), false);
  assert.equal(underPlace("/Projects/App", "/projects/app"), false);
  assert.equal(underPlace("ssh://host/repo", "ssh://other/repo"), false);
  assert.equal(underPlace("ssh://host/", "ssh://host/repo"), true);
  assert.equal(underPlace("/", "/projects/app"), true);
});

test("minimized panes persist while legacy and invalid flags keep their original shape", () => {
  assert.deepEqual(readSeeds([{ kind: "folder", path: "/x", minimized: true }]), [
    { kind: "folder", path: "/x", minimized: true },
  ]);
  assert.deepEqual(readSeeds(["/x", { kind: "repository", path: "/repo", minimized: "yes" }]), [
    { kind: "folder", path: "/x" },
    { kind: "repository", path: "/repo" },
  ]);
});

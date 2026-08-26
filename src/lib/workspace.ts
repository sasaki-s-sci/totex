import { invoke } from "@tauri-apps/api/core";

import type { Repository } from "../types/git";

/** A branch and the directory it is checked out in. */
export type Workspace = {
  repoId: string;
  branch: string;
  path: string;
};

/**
 * What is uncommitted in a worktree, counted in files by what became of them.
 *
 * Files rather than lines, and split three ways, because that is what the graph
 * draws: a branch's rim is these three as shares of one circle, so a copy that
 * is only adding reads differently from one that is throwing things away.
 */
export type WorktreeStatus = {
  /** Files the worktree has that its commit does not, tracked or not. */
  added: number;
  /** Files its commit has that the worktree does not. */
  deleted: number;
  /** Files both have, with something different in them. */
  modified: number;
};

/** Whether there is anything uncommitted here at all, counted in files. */
export function dirtyCount(status: WorktreeStatus): number {
  return status.added + status.deleted + status.modified;
}

/**
 * Cuts a branch at a commit and gives it a worktree.
 *
 * No path is asked for: where a branch's worktree goes is derived from the
 * repository and the branch, so the same branch always comes back to the same
 * directory and nobody has to invent one.
 */
export function createWorkspace(repoId: string, branch: string, oid: string): Promise<Workspace> {
  return invoke("create_workspace", { repoId, branch, oid });
}

/** Gives an existing branch its worktree, or hands back the one it has. */
export function openWorkspace(repoId: string, branch: string): Promise<Workspace> {
  return invoke("open_workspace", { repoId, branch });
}

/** Takes a worktree away. Refuses uncommitted work unless `force`. */
export function removeWorkspace(repoId: string, path: string, force: boolean): Promise<void> {
  return invoke("remove_workspace", { repoId, path, force });
}

/**
 * Deletes a local branch and everything standing on it: its linked worktree,
 * and whatever was left uncommitted in there. A branch nothing has merged goes
 * the same way. The remote-tracking branch is left alone.
 */
export function deleteBranch(repoId: string, branch: string): Promise<void> {
  return invoke("delete_branch", { repoId, branch });
}

/**
 * What is uncommitted in each of many worktrees, in one crossing.
 *
 * Keyed by the path asked about. A directory git would not answer for is absent
 * rather than an error: the graph draws a ring for it either way.
 */
export function worktreeStatuses(paths: string[]): Promise<Record<string, WorktreeStatus>> {
  return invoke("workspace_statuses", { paths });
}

/**
 * Brings one branch down from one remote.
 *
 * `branch` is the name the remote knows it by — `main`, not `origin/main` —
 * because that is what is being asked for and the remote is named beside it.
 * Nothing in any working tree moves: a fetch writes refs and objects, so the
 * only thing that changes is where the remote end of the branch is drawn.
 */
export function fetchBranch(repoId: string, remote: string, branch: string): Promise<void> {
  return invoke("fetch_branch", { repoId, remote, branch });
}

/**
 * What came of taking a branch up to the remote end it follows.
 *
 * A refusal arrives as an answer rather than as a failure: the remote was
 * asked, git read both ends, and this is what it said about the two of them.
 * The words are git's own and they are shown — see `useMarks`, where every
 * other refusal in the window is a red ring and nothing else.
 */
export type Followed = {
  /** Git's own words for what it would not do, or null where it did it. */
  refused: string | null;
};

/**
 * Brings one branch up to the remote end it follows: fetch, then merge that end
 * into the branch, in the branch's own worktree.
 *
 * `remoteBranch` is the name the remote knows it by — `main`, not
 * `origin/main` — because the remote is named beside it.
 */
export function followBranch(
  repoId: string,
  branch: string,
  remote: string,
  remoteBranch: string,
): Promise<Followed> {
  return invoke("follow_branch", { repoId, branch, remote, remoteBranch });
}

/**
 * Asks every remote of one repository, and takes the branches that were only
 * behind up to what came back.
 *
 * The automatic round, and fast-forward only: a branch with commits of its own
 * is two ends that have parted, and joining those is a decision rather than
 * something a timer does. Nothing is reported and nothing can fail — a remote
 * that would not answer is a branch left where it was.
 */
export function followRepository(repoId: string): Promise<void> {
  return invoke("follow_repository", { repoId });
}

/** Merges `source` into `target`, in `target`'s own worktree. */
export function mergeBranch(repoId: string, source: string, target: string): Promise<string> {
  return invoke("merge_branch", { repoId, source, target });
}

export function revertCommit(repoId: string, branch: string, oid: string): Promise<void> {
  return invoke("revert_commit", { repoId, branch, oid });
}

export function cherryPickCommit(repoId: string, branch: string, oid: string): Promise<void> {
  return invoke("cherry_pick_commit", { repoId, branch, oid });
}

export function undoCommit(repoId: string, branch: string, oid: string): Promise<void> {
  return invoke("undo_commit", { repoId, branch, oid });
}

/**
 * Whether git would take this as a branch name.
 *
 * `git check-ref-format --branch` is the authority and the backend still asks
 * it, but a box that offers to create a name git is about to refuse has already
 * failed: the offer is what tells you, so it is withheld instead. These are
 * that command's rules, as far as something typed into a box can break them.
 */
export function isBranchName(name: string): boolean {
  if (name.length === 0 || name === "@") return false;
  // Control characters, space, and the characters git reserves for the ways a
  // ref can be asked for.
  if (/[\0-\x20\x7f~^:?*[\\]/.test(name)) return false;
  if (name.includes("..") || name.includes("@{")) return false;
  if (name.startsWith("/") || name.endsWith("/") || name.includes("//")) return false;
  if (name.endsWith(".") || name.endsWith(".lock")) return false;
  // No part of the path may start with a dot or end in `.lock` either.
  return name
    .split("/")
    .every((part) => part.length > 0 && !part.startsWith(".") && !part.endsWith(".lock"));
}

/** Whether the repository already has a local branch under this name. */
export function branchTaken(repository: Repository, name: string): boolean {
  return repository.branches.some(
    (branch) => branch.kind === "local" && branch.name === name.trim(),
  );
}

/**
 * The name a branch cut from `from` gets, when nobody was asked for one.
 *
 * Named after where it came from and numbered from there, so the graph reads
 * as `main`, `main-1`, `main-2` — and cutting from `main-1` gives `main-3`
 * rather than `main-1-1`, because the number says which sibling it is and not
 * how many times someone has clicked.
 */
export function nextBranchName(repository: Repository, from: string): string {
  const taken = new Set(
    repository.branches.filter((branch) => branch.kind === "local").map((branch) => branch.name),
  );
  const base = from.replace(/-\d+$/, "");
  for (let counter = 1; ; counter++) {
    const name = `${base}-${counter}`;
    if (!taken.has(name)) return name;
  }
}

/** The prefix the box opens under, and the whole of what it suggests. */
export const DRAFT_PREFIX = "dev/";

/**
 * The name already in the box when a branch is cut from a commit by hand.
 *
 * What the branch is for is not known here, and a suggestion that has to be
 * cleared before anything can be typed is worth less than none at all — so it
 * is a prefix and a random tail rather than a guess drawn from the history. It
 * is a name git will take and a name no repository is likely to hold, which is
 * what lets the tick be out from the moment the box opens: pressing it straight
 * away is the whole of the common case. A random tail rather than a counter,
 * for the same reason branches cut by the graph get one — two of these can be
 * started a second apart, and neither has read the other's branch list.
 */
export function draftBranchName(): string {
  return `${DRAFT_PREFIX}${Math.random().toString(36).slice(2, 8)}`;
}

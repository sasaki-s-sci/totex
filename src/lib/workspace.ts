import { invoke } from "@tauri-apps/api/core";

import type { Repository } from "../types/git";
import { isKeepingSpare } from "./spare";

export type Workspace = {
  repoId: string;
  branch: string;
  path: string;
};

export type WorktreeStatus = {
  added: number;
  deleted: number;
  modified: number;
};

/** Mirrors `Sync` in src-tauri/src/git/workspace/history.rs. Only `blocked` turns a ring red. */
export type Sync = {
  taken: number;
  left: number;
  blocked: boolean;
};

export function dirtyCount(status: WorktreeStatus): number {
  return status.added + status.deleted + status.modified;
}

/** Takes the repository's spare worktree when the setting keeps one; see `workspace/spare.rs`. */
export function createWorkspace(repoId: string, branch: string, oid: string): Promise<Workspace> {
  return invoke("create_workspace", { repoId, branch, oid, spare: isKeepingSpare() });
}

/** Best effort either way: makes the spare each repository lacks, or removes the one it has. */
export function tendSpares(repoIds: string[], wanted: boolean): Promise<void> {
  return invoke("tend_spares", { repoIds, wanted });
}

export function openWorkspace(repoId: string, branch: string): Promise<Workspace> {
  return invoke("open_workspace", { repoId, branch });
}

export function deleteBranch(repoId: string, branch: string): Promise<void> {
  return invoke("delete_branch", { repoId, branch });
}

export function worktreeStatuses(paths: string[]): Promise<Record<string, WorktreeStatus>> {
  return invoke("workspace_statuses", { paths });
}

/** `branch` is the remote's own name: `main`, not `origin/main`. */
export function fetchBranch(repoId: string, remote: string, branch: string): Promise<void> {
  return invoke("fetch_branch", { repoId, remote, branch });
}

/** Fast-forward only; a remote that will not answer leaves the branch where it was. */
export function followRepository(repoId: string): Promise<void> {
  return invoke("follow_repository", { repoId });
}

export function fetchRepository(repoId: string): Promise<void> {
  return invoke("fetch_repository", { repoId });
}

export function mergeBranch(repoId: string, source: string, target: string): Promise<string> {
  return invoke("merge_branch", { repoId, source, target });
}

export function syncBranch(repoId: string, remote: string, branch: string): Promise<Sync> {
  return invoke("sync_branch", { repoId, remote, branch });
}

/** Mirrors `git check-ref-format --branch`, so a name git would refuse is never offered. */
export function isBranchName(name: string): boolean {
  if (name.length === 0 || name === "@") return false;
  if (/[\0-\x20\x7f~^:?*[\\]/.test(name)) return false;
  if (name.includes("..") || name.includes("@{")) return false;
  if (name.startsWith("/") || name.endsWith("/") || name.includes("//")) return false;
  if (name.endsWith(".") || name.endsWith(".lock")) return false;
  return name
    .split("/")
    .every((part) => part.length > 0 && !part.startsWith(".") && !part.endsWith(".lock"));
}

export function branchTaken(repository: Repository, name: string): boolean {
  return repository.branches.some(
    (branch) => branch.kind === "local" && branch.name === name.trim(),
  );
}

export const DRAFT_PREFIX = "dev/";

/** A random tail rather than a counter: two windows may cut a branch a second apart. */
export function draftBranchName(): string {
  return `${DRAFT_PREFIX}${Math.random().toString(36).slice(2, 8)}`;
}

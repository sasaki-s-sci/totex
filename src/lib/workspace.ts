import { invoke } from "@tauri-apps/api/core";

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

/** Fast-forward only; a remote that will not answer leaves the branch where it was. */
export function followRepository(repoId: string): Promise<void> {
  return invoke("follow_repository", { repoId });
}

export function fetchRepository(repoId: string): Promise<void> {
  return invoke("fetch_repository", { repoId });
}

export const DRAFT_PREFIX = "dev/";

/** A random tail rather than a counter: two windows may cut a branch a second apart. */
export function draftBranchName(): string {
  return `${DRAFT_PREFIX}${Math.random().toString(36).slice(2, 8)}`;
}

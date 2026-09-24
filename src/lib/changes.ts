import type { Change } from "../folder/api";
import type { Folder } from "../hooks/useWorkspace";
import type { Workspace } from "../types/git";
import type { WorktreeStatus } from "./workspace";

/** What became of each place on the canvas: by worktree path, by repository id and by folder root. */
export type Changes = {
  worktrees: ReadonlyMap<string, Change>;
  repositories: ReadonlyMap<string, Change>;
  folders: ReadonlyMap<string, Change>;
};

export const NO_CHANGES: Changes = {
  worktrees: new Map(),
  repositories: new Map(),
  folders: new Map(),
};

/**
 * The column's rule at the graph's size: the one colour the files agree on, and amber when they do
 * not. A worktree that gained one file and lost another has been rewritten, whatever either file
 * did.
 */
export function changeOf(status: WorktreeStatus): Change | null {
  const { added, deleted, modified } = status;
  if (added + deleted + modified === 0) return null;
  if (deleted === 0 && modified === 0) return "added";
  if (added === 0 && modified === 0) return "deleted";
  return "modified";
}

/**
 * The colour climbs: a repository takes what its worktrees come to, and a folder what its
 * repositories come to, so a change under a folded repository is seen from the folder's row.
 */
export function changesOf(
  workspace: Workspace | null,
  folders: readonly Folder[],
  statuses: ReadonlyMap<string, WorktreeStatus>,
): Changes {
  const worktrees = new Map<string, Change>();
  const repositories = new Map<string, Change>();
  const summed = new Map<string, WorktreeStatus>();

  for (const repository of workspace?.repositories ?? []) {
    const sum = { added: 0, deleted: 0, modified: 0 };
    for (const worktree of repository.worktrees) {
      const status = statuses.get(worktree.path);
      if (!status) continue;
      const change = changeOf(status);
      if (change) worktrees.set(worktree.path, change);
      add(sum, status);
    }
    summed.set(repository.id, sum);
    const change = changeOf(sum);
    if (change) repositories.set(repository.id, change);
  }

  const roots = new Map<string, Change>();
  for (const folder of folders) {
    // A repository standing as itself has no row above it to colour.
    if (folder.kind !== "folder") continue;
    const sum = { added: 0, deleted: 0, modified: 0 };
    for (const id of folder.repositories) {
      const held = summed.get(id);
      if (held) add(sum, held);
    }
    const change = changeOf(sum);
    if (change) roots.set(folder.root, change);
  }

  return { worktrees, repositories, folders: roots };
}

function add(sum: { added: number; deleted: number; modified: number }, status: WorktreeStatus) {
  sum.added += status.added;
  sum.deleted += status.deleted;
  sum.modified += status.modified;
}

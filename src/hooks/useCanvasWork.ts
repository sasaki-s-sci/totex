// Every callback is held still: the canvas actions are context, and a rebuilt one re-renders every
// node.

import { useCallback } from "react";
import type { MergeRequest, SyncRequest } from "../canvas/CanvasProps";
import type { FetchRequest, WorkRequest } from "../canvas/graphActions";
import { branchMark } from "../canvas/graphMarks";
import type { CommitFlowNode } from "../lib/graph";
import { shellSession } from "../lib/session";
import {
  createWorkspace,
  draftBranchName,
  fetchBranch,
  mergeBranch,
  openWorkspace,
  syncBranch,
} from "../lib/workspace";
import type { CommitTarget } from "../menus/CommitMenu";
import type { Repository } from "../types/git";
import type { useMarks } from "./useMarks";
import type { useSessions } from "./useSessions";

export function useCanvasWork({
  openSession,
  fail,
  hold,
  release,
  setCommitMenu,
  onBrowseFolder,
}: {
  openSession: ReturnType<typeof useSessions>["open"];
  fail: ReturnType<typeof useMarks>["fail"];
  hold: ReturnType<typeof useMarks>["hold"];
  release: ReturnType<typeof useMarks>["release"];
  setCommitMenu: React.Dispatch<React.SetStateAction<CommitTarget | null>>;
  onBrowseFolder: (repository: Repository, path: string) => void;
}) {
  const openWork = useCallback(
    ({ repository, branch, cwd }: WorkRequest) => {
      // A folder is already a directory; only a branch never checked out gets a worktree.
      const start = cwd
        ? Promise.resolve(cwd)
        : repository
          ? openWorkspace(repository.id, branch).then((workspace) => workspace.path)
          : Promise.reject(new Error("nowhere to open"));

      start
        // No repository asked: the press was on a folder's row.
        .then((path) => openSession(shellSession(path, branch, repository === null)))
        .catch(() => repository && fail(branchMark(repository.id, branch)));
    },
    [openSession, fail],
  );

  const browseWorktree = useCallback(
    ({ repository, branch, cwd }: WorkRequest & { repository: Repository }) => {
      const key = branchMark(repository.id, branch);
      if (!cwd) hold(key);
      const start = cwd
        ? Promise.resolve(cwd)
        : openWorkspace(repository.id, branch).then((workspace) => workspace.path);

      start
        .then((path) => {
          release(key);
          onBrowseFolder(repository, path);
        })
        .catch(() => {
          release(key);
          fail(key);
        });
    },
    [fail, hold, onBrowseFolder, release],
  );

  const pickCommit = useCallback(
    (node: CommitFlowNode, at: { x: number; y: number }) => {
      const { repository, commit } = node.data;
      setCommitMenu({ repository, commit, at });
    },
    [setCommitMenu],
  );

  const cutBranch = useCallback(
    (node: CommitFlowNode) => {
      const { repository, commit } = node.data;
      createWorkspace(repository.id, draftBranchName(), commit.id)
        .then((workspace) => openSession(shellSession(workspace.path, workspace.branch)))
        .catch(() => undefined);
    },
    [openSession],
  );

  const merge = useCallback(
    ({ repository, source, target }: MergeRequest) => {
      // The target branch is the one that changes, so it is the mark that waits and goes red.
      const key = branchMark(repository.id, target);
      hold(key);
      mergeBranch(repository.id, source, target)
        .then(() => release(key))
        .catch(() => {
          release(key);
          fail(key);
        });
    },
    [fail, hold, release],
  );

  // Only a sync that could take nothing goes red; a partial sync is drawn by the graph itself.
  const sync = useCallback(
    ({ repository, branch, origin }: SyncRequest) => {
      const key = branchMark(repository.id, branch);
      hold(key);
      syncBranch(repository.id, origin.remote, origin.branch)
        .then((brought) => {
          release(key);
          if (brought.taken === 0 && brought.blocked) fail(key);
        })
        .catch(() => {
          release(key);
          fail(key);
        });
    },
    [fail, hold, release],
  );

  const fetch = useCallback(
    ({ repository, branch, fetch }: FetchRequest) => {
      // The head the pull was made on is the mark that waits.
      const key = branchMark(repository.id, branch);
      hold(key);
      fetchBranch(repository.id, fetch.remote, fetch.branch)
        .then(() => release(key))
        .catch(() => {
          release(key);
          fail(key);
        });
    },
    [fail, hold, release],
  );

  return { openWork, browseWorktree, pickCommit, cutBranch, merge, sync, fetch };
}

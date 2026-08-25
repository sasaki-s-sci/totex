/**
 * What a mark on the canvas asks the window for: a terminal in a branch, a
 * commit's menu, a merge, and a fetch.
 *
 * Every one of them is held still, because the graph's actions are context: a
 * callback rebuilt on every render is every node on the canvas told that
 * something changed.
 */

import { useCallback } from "react";
import type { CommitTarget } from "../components/CommitMenu";
import type { FetchRequest, MergeRequest } from "../components/GitGraph";
import type { WorkRequest } from "../components/graphActions";
import { branchMark } from "../components/graphMarks";
import type { CommitFlowNode } from "../lib/graph";
import { shellSession } from "../lib/session";
import { fetchBranch, mergeBranch, openWorkspace } from "../lib/workspace";
import type { useMarks } from "./useMarks";
import type { useSessions } from "./useSessions";

export function useCanvasWork({
  openSession,
  fail,
  hold,
  release,
  setCommitMenu,
}: {
  openSession: ReturnType<typeof useSessions>["open"];
  fail: ReturnType<typeof useMarks>["fail"];
  hold: ReturnType<typeof useMarks>["hold"];
  release: ReturnType<typeof useMarks>["release"];
  setCommitMenu: React.Dispatch<React.SetStateAction<CommitTarget | null>>;
}) {
  /**
   * Opens a terminal in a branch.
   *
   * A branch that has no worktree yet gets one here, on the way in: a branch
   * you can see is a branch you can work in, and the directory it needs is
   * derived rather than asked for — so there is nothing to decide and nothing
   * to distinguish a branch that has one from a branch that does not.
   */
  const openWork = useCallback(
    ({ repository, branch, cwd }: WorkRequest) => {
      // A folder is already a directory, so there is nothing to make; only a
      // branch that has never been checked out is answered with a worktree.
      const start = cwd
        ? Promise.resolve(cwd)
        : repository
          ? openWorkspace(repository.id, branch).then((workspace) => workspace.path)
          : Promise.reject(new Error("nowhere to open"));

      start
        .then((path) => openSession(shellSession(path, branch)))
        // Nothing to mark when there is no branch: a folder that would not open
        // is the shell saying so, in the terminal that was asked for.
        .catch(() => repository && fail(branchMark(repository.id, branch)));
    },
    [openSession, fail],
  );

  // What the last change was is not reported. The graph has already moved:
  // the commit is drawn, the ring has filled, the branch is where it now is —
  // and a line of text saying so was the same news a second time.

  // Clicking a commit is how work starts from it: the graph already answers
  // everything else about a commit, so there is nothing to open a panel for.
  const pickCommit = useCallback(
    (node: CommitFlowNode, at: { x: number; y: number }) => {
      const { repository, commit } = node.data;
      setCommitMenu({ repository, commit, at });
    },
    [setCommitMenu],
  );

  const merge = useCallback(
    ({ repository, source, target }: MergeRequest) => {
      // The branch being merged into is the one that changes, so it is the one
      // that waits — and the one that goes red when git will not do it.
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

  const fetch = useCallback(
    ({ repository, branch, fetch }: FetchRequest) => {
      // The head the pull was made on is the one that waits: on a branch at
      // rest that is the ring the pair share, and on one whose ends have parted
      // it is the remote end hanging under the local one. Either way it is the
      // mark the hand was on, which is where an answer is looked for.
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

  /** Something the whole window depends on is not answering. */

  return { openWork, pickCommit, merge, fetch };
}

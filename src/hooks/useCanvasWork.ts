import { useCallback } from "react";
import type { WorkRequest } from "../canvas/graphActions";
import { newWorkBase } from "../lib/graph/history";
import { shellSession } from "../lib/session";
import { createWorkspace, draftBranchName, openWorkspace } from "../lib/workspace";
import type { Repository } from "../types/git";
import type { useSessions } from "./useSessions";

export function useCanvasWork({
  openSession,
  fail,
  onBrowseFolder,
}: {
  openSession: ReturnType<typeof useSessions>["open"];
  fail: () => void;
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
        .catch(fail);
    },
    [openSession, fail],
  );

  const browseWorktree = useCallback(
    ({ repository, branch, cwd }: WorkRequest & { repository: Repository }) => {
      const start = cwd
        ? Promise.resolve(cwd)
        : openWorkspace(repository.id, branch).then((workspace) => workspace.path);

      start
        .then((path) => {
          onBrowseFolder(repository, path);
        })
        .catch(fail);
    },
    [fail, onBrowseFolder],
  );

  // Cut where the repository's own work starts from; a bare history with neither has nothing to cut.
  const newWork = useCallback(
    (repository: Repository) => {
      const oid = newWorkBase(repository).commit;
      if (!oid) return;
      createWorkspace(repository.id, draftBranchName(), oid)
        .then((workspace) => openSession(shellSession(workspace.path, workspace.branch)))
        .catch(fail);
    },
    [openSession, fail],
  );

  return { openWork, browseWorktree, newWork };
}

import { useCallback, useState } from "react";
import type { BranchPick } from "../canvas/graphActions";
import type { CommitTarget } from "../menus/CommitMenu";
import { useFrontState } from "../shell/state";

export function useWindowMenus() {
  const [commit, setCommit] = useState<CommitTarget | null>(null);
  const [worktree, setWorktree] = useState<BranchPick | null>(null);
  // Zero is closed; each increment re-centres the page in the viewport.
  const [settingsRequest, setSettingsRequest] = useFrontState("window.settings", 0);
  const openSettings = useCallback(() => setSettingsRequest((request) => request + 1), []);
  const closeSettings = useCallback(() => setSettingsRequest(0), []);
  const closeCommit = useCallback(() => setCommit(null), []);
  const closeWorktree = useCallback(() => setWorktree(null), []);

  return {
    commit,
    setCommit,
    closeCommit,
    worktree,
    setWorktree,
    closeWorktree,
    settingsRequest,
    openSettings,
    closeSettings,
  };
}

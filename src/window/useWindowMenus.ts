import { useCallback, useState } from "react";
import type { BranchPick } from "../canvas/graphActions";
import { useFrontState } from "../shell/state";

export function useWindowMenus() {
  const [worktree, setWorktree] = useState<BranchPick | null>(null);
  // Zero is closed; each increment re-centres the page in the viewport.
  const [settingsRequest, setSettingsRequest] = useFrontState("window.settings", 0);
  const openSettings = useCallback(() => setSettingsRequest((request) => request + 1), []);
  const closeSettings = useCallback(() => setSettingsRequest(0), []);
  const closeWorktree = useCallback(() => setWorktree(null), []);

  return {
    worktree,
    setWorktree,
    closeWorktree,
    settingsRequest,
    openSettings,
    closeSettings,
  };
}

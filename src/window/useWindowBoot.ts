import { useEffect } from "react";
import { warmInTurn } from "../lib/onDemand";
import { confirmFront, watchUpdateChoices } from "../lib/update";
import { commitPart, settingsPart, sidebarPart, worktreePart } from "../parts";
import type { Workspace } from "../types/git";

/** The terminal chunk waits for a canvas: nothing can ask for one before. */
export function useWindowBoot(workspace: Workspace | null) {
  useEffect(confirmFront, []);
  useEffect(watchUpdateChoices, []);
  useEffect(() => warmInTurn([commitPart, worktreePart, settingsPart]), []);
  useEffect(() => (workspace ? warmInTurn([sidebarPart]) : undefined), [workspace]);
}

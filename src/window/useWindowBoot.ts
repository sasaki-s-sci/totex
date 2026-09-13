import { useEffect } from "react";
import { warmInTurn } from "../lib/onDemand";
import { confirmFront, watchUpdateChoices } from "../lib/update";
import { commitPart, settingsPart, sidebarPart, worktreePart } from "../parts";
import type { Workspace } from "../types/git";

/**
 * What the window does once it exists: confirms the front it was drawn from,
 * keeps the release list fresh, and fetches the heavier chunks in idle time.
 * The terminal chunk waits for a canvas, since nothing can ask for one before.
 */
export function useWindowBoot(workspace: Workspace | null) {
  useEffect(confirmFront, []);
  useEffect(watchUpdateChoices, []);
  useEffect(() => warmInTurn([commitPart, worktreePart, settingsPart]), []);
  useEffect(() => (workspace ? warmInTurn([sidebarPart]) : undefined), [workspace]);
}

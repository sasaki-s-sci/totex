import { createContext, useContext } from "react";

import type { WorktreeStatus } from "../lib/workspace";

/** What each worktree has uncommitted, by the directory it is in. */
export type WorktreeStatuses = ReadonlyMap<string, WorktreeStatus>;

/**
 * Passed through context rather than through node data, for the same reason the
 * actions are: React Flow decides what to redraw by comparing node data, and
 * folding a count that moves on its own into that data would rebuild the layout
 * every time someone saved a file.
 */
const WorktreeStatusContext = createContext<WorktreeStatuses>(new Map());

export const WorktreeStatusProvider = WorktreeStatusContext.Provider;

export function useWorktreeStatuses(): WorktreeStatuses {
  return useContext(WorktreeStatusContext);
}

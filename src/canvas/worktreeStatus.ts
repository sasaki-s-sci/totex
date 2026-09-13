import { createContext, useContext } from "react";

import type { WorktreeStatus } from "../lib/workspace";

export type WorktreeStatuses = ReadonlyMap<string, WorktreeStatus>;

const WorktreeStatusContext = createContext<WorktreeStatuses>(new Map());

export const WorktreeStatusProvider = WorktreeStatusContext.Provider;

export function useWorktreeStatuses(): WorktreeStatuses {
  return useContext(WorktreeStatusContext);
}

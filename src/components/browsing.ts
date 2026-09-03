import { createContext, useContext } from "react";

import type { Browsing } from "../lib/worktrees";

/**
 * Which worktrees the folder column has a pane in, by directory.
 *
 * Passed through context rather than through node data, for the same reason the
 * worktree counts are: React Flow decides what to redraw by comparing node
 * data, and folding this into it would lay the whole graph out again every time
 * somebody walked into a folder.
 */
const BrowsingContext = createContext<Browsing>(new Set<string>());

export const BrowsingProvider = BrowsingContext.Provider;

export function useBrowsing(): Browsing {
  return useContext(BrowsingContext);
}

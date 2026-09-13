import { createContext, useContext } from "react";

import type { Browsing } from "../lib/worktrees";

const BrowsingContext = createContext<Browsing>(new Set<string>());

export const BrowsingProvider = BrowsingContext.Provider;

export function useBrowsing(): Browsing {
  return useContext(BrowsingContext);
}

import { createContext, useContext } from "react";

import type { Change } from "../folder/api";
import { type Changes, NO_CHANGES } from "../lib/changes";

const ChangesContext = createContext<Changes>(NO_CHANGES);

export const ChangesProvider = ChangesContext.Provider;

export function useChanges(): Changes {
  return useContext(ChangesContext);
}

/** The rim's three colours as the stylesheet's variables, so a line and a rim answer alike. */
export const CHANGE_COLOUR: Record<Change, string> = {
  added: "var(--mui-palette-success-main)",
  modified: "var(--mui-palette-warning-main)",
  deleted: "var(--mui-palette-error-main)",
};

/** The class a name or mark wears for what became of the files under it; see folders.css. */
export function changeClass(change: Change | undefined): string {
  return change ? ` is-${change}` : "";
}

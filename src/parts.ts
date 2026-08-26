/**
 * The heavy halves of the window, loaded separately from the first paint, and
 * the folders the last run was left on.
 */

import { onDemand } from "./lib/onDemand";
import type { Workspace } from "./types/git";

/**
 * The heavy halves of the window, loaded separately from the first paint.
 *
 * A window that has just opened is a column of folders: the canvas has read
 * nothing, no session is running, and no menu is open. The graph is requested
 * immediately so its canvas is always present; terminals, menus and pages stay
 * on demand. Keeping them in separate chunks leaves all of them off the way to
 * the first column.
 */
export const graphPart = onDemand(() =>
  import("./components/GitGraph").then((part) => part.GitGraph),
);
export const panelPart = onDemand(() =>
  import("./components/SidePanel").then((part) => part.SidePanel),
);
export const commitPart = onDemand(() =>
  import("./components/CommitMenu").then((part) => part.CommitMenu),
);
export const worktreePart = onDemand(() =>
  import("./components/WorktreeMenu").then((part) => part.WorktreeMenu),
);
export const settingsPart = onDemand(() =>
  import("./components/nodes/SettingsNode").then((part) => part.SettingsNode),
);
/** What draws a markdown file as a page: a parser and a sanitiser, and neither
 *  of them anything the window needs until a preview is asked for. */
export const markdownPart = onDemand(() =>
  import("./components/nodes/preview/MarkdownReading").then((part) => part.MarkdownReading),
);
export const ROOTS_KEY = "totex.roots";
export const EMPTY_WORKSPACE: Workspace = { root: "file-previews", repositories: [], warnings: [] };

/**
 * The folders the column was showing when the window last closed.
 *
 * Where they were browsing, and nothing about the graph: what the graph draws
 * is asked for a folder at a time, so a window that has just opened has a
 * column to pick up from and a canvas that has read nothing.
 */
export function storedRoots(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(ROOTS_KEY) ?? "[]");
    // Whatever is under the key was written by some earlier version of this
    // window, so it is read as a claim rather than as a fact: anything that is
    // not a list of paths is a column that cannot be restored, and an empty
    // column is what a window opens as anyway.
    if (Array.isArray(stored)) return stored.filter((path) => typeof path === "string");
  } catch {
    // A window that cannot remember where it was browsing starts with nothing
    // open, which is the plus in the header and the folders behind it.
  }
  return [];
}

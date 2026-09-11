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
/** A window holding one card torn off the main one, which draws nothing else
 *  and is asked for by nothing else — see `lib/cardWindow`. */
export const cardPart = onDemand(() =>
  import("./components/CardWindow").then((part) => part.CardWindow),
);
export const panelPart = onDemand(() =>
  import("./components/SidePanel").then((part) => part.SidePanel),
);
/** The terminal itself, for a page on the canvas: the same emulator the panel
 *  draws, and the same chunk, so a window with the panel up has it already. */
export const terminalPart = onDemand(() =>
  import("./components/CliView").then((part) => part.CliView),
);
export const commitPart = onDemand(() =>
  import("./components/CommitMenu").then((part) => part.CommitMenu),
);
export const worktreePart = onDemand(() =>
  import("./components/WorktreeMenu").then((part) => part.WorktreeMenu),
);
/** What a repository says can be run in it, which nothing asks for until the
 *  key that asks for it is pressed. */
export const tasksPart = onDemand(() =>
  import("./components/TaskMenu").then((part) => part.TaskMenu),
);
export const settingsPart = onDemand(() =>
  import("./components/settings/SettingsContent").then((part) => part.SettingsContent),
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

export const schemaPart = onDemand(() =>
  import("./components/nodes/preview/SchemaReading").then((part) => part.SchemaReading),
);

export const pdfPart = onDemand(() =>
  import("./components/nodes/preview/PdfReading").then((part) => part.PdfReading),
);
export const dxfPart = onDemand(() =>
  import("./components/nodes/preview/DxfReading").then((part) => part.DxfReading),
);

export const mediaPart = onDemand(() =>
  import("./components/nodes/preview/MediaReading").then((part) => part.MediaReading),
);
export const htmlPart = onDemand(() =>
  import("./components/nodes/preview/HtmlReading").then((part) => part.HtmlReading),
);

export const tablePart = onDemand(() =>
  import("./components/nodes/preview/TableReading").then((part) => part.TableReading),
);

export const modelPart = onDemand(() =>
  import("./components/nodes/preview/ModelReading").then((part) => part.ModelReading),
);

export const epubPart = onDemand(() =>
  import("./components/nodes/preview/EpubReading").then((part) => part.EpubReading),
);

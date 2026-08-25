/**
 * What a row of a folder pane is drawn with: the colours a change takes, how
 * far a level is set in, and how many rows arrive at a time.
 */

import type { Change } from "./api";

/** Small enough that a column of panes still reads as one list. */
export const ICON = { minWidth: 22, color: "text.secondary" } as const;

/**
 * What a row is drawn in when its file is not what the last commit says it is.
 *
 * The three colours the branches on the graph carry on their rims — the scheme's
 * `added`, `changed` and `removed`, which is a file that has arrived, one that
 * has been rewritten and one that has gone — so the column and the canvas answer
 * the same question the same way, one in names and the other in shares of a
 * circle. Which three hues those actually are is the preset's to say; see
 * src/theme/scheme.ts. MUI's names for them are what `sx` takes.
 *
 * A folder is drawn in what everything underneath it comes to, which is how the
 * one colour a file has that is not on the disk any more is seen at all: a
 * deleted file has no row, and the folder it was in turns `removed`. A folder
 * whose contents disagree is `changed` — it has been rewritten, whatever each
 * file did.
 */
export const CHANGE_COLOUR: Record<Change, string> = {
  added: "success.main",
  modified: "warning.main",
  deleted: "error.main",
};

/**
 * What a row is drawn in when git was told to leave the file alone.
 *
 * `node_modules`, a `dist`, a log — on the disk, in the listing, and no part of
 * what the repository is. Faint rather than a colour of its own, because that
 * is the shape of the fact: the three above each say something became of a
 * file, and this one says the opposite — that nothing about this one is being
 * watched, so there is nothing for it to have become.
 *
 * MUI's own `text.disabled` rather than a name out of the preset, for the same
 * reason the icons are `text.secondary`: it is the faint wash of whatever ink
 * the scheme is written in, and stays faint in both of them without whoever
 * chose the colours having to have an opinion about it. See src/theme/index.ts.
 */
export const IGNORED_COLOUR = "text.disabled";

/** Rows sit one step in from the folder the pane is showing. */
export const ROW_INDENT = 2;

/** How far a folder's contents are set in from the folder itself. */
export const LEVEL_STEP = 1.25;

/**
 * How many of a directory's rows are drawn before it has been scrolled through.
 *
 * A directory is as long as it is — the backend will hand over five thousand
 * entries, and it says so when it stops there — while a column shows about
 * thirty of them at a time. Every row is a button, an icon, a name and two
 * marks, so a folder like that was fifty thousand elements built to be scrolled
 * past. This is the first screenful and some room to move; the rest arrives as
 * it is scrolled to, a chunk at a time, and never at all for the folders that
 * are opened to look at one name.
 */
export const FIRST_ROWS = 80;

/** How many more arrive each time the end of the rows comes into view. */
export const MORE_ROWS = 160;

import type { Change } from "../../folder/api";

export const ICON = { minWidth: 22, color: "text.secondary" } as const;

/**
 * The graph's three rim colours, so column and canvas answer alike. A folder takes what everything
 * under it comes to, which is how a deleted file is seen at all.
 */
export const CHANGE_COLOUR: Record<Change, string> = {
  added: "success.main",
  modified: "warning.main",
  deleted: "error.main",
};

/**
 * Faint rather than a colour: an ignored file has nothing to have become. `text.disabled` stays
 * faint in both schemes.
 */
export const IGNORED_COLOUR = "text.disabled";

export const ROW_INDENT = 2;

export const LEVEL_STEP = 1.25;

/**
 * A directory can be five thousand rows of several elements each: draw a screenful and grow as
 * scrolled.
 */
export const FIRST_ROWS = 80;

export const MORE_ROWS = 160;

/** Around the row, not through it: the name keeps git's colour. */
export const TAKING_DROP = {
  bgcolor: "action.hover",
  outline: "1px solid",
  outlineColor: "primary.main",
  outlineOffset: "-1px",
} as const;

/** The refusal colour; fades on its own. See `useDrops`. */
export const REFUSED_DROP = {
  outline: "1px solid",
  outlineColor: "error.main",
  outlineOffset: "-1px",
} as const;

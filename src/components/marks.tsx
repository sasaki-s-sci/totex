import { Box } from "@mui/material";

/**
 * The marks the window's own controls carry, and the button they sit in.
 *
 * Drawn here rather than taken from the icon set, and sized in pixels rather
 * than in `em`: an icon that works its size out from the font renders at
 * whatever the engine decides one em is, and this app has already been caught
 * by that — WebKit gave a glyph no size at all and left an empty disc on the
 * canvas. A path at a stated size is the same drawing in every engine.
 *
 * The buttons themselves are transparent: no strip to sit in, no plate behind
 * them, nothing but the mark. In the folder column they stand at full: they are
 * part of the rows they sit in, the column is read a name at a time, and a mark
 * that has to be found by moving the pointer over the row it belongs to is a
 * mark that is not there until it is looked for. `faint` is for the ones that
 * sit over something that is not theirs — the band the window is picked up by,
 * the canvas the graph is drawn on — where anything out at rest is one more
 * thing on top of what is being read. The one row the window reserves is that
 * band along the top, and it holds nothing but these marks — the sidebar's two
 * at one end, the window's three at the other.
 */
export const SIZE = 15;

/**
 * The size a mark drawn beside a name in the folder column is set at.
 *
 * The rows there carry icons from the set as well — a file, a link — and a
 * drawing of our own at the marks' own size would read as a smaller kind of
 * thing standing in the same column. This is what MUI calls
 * small, which is what those rows are already using.
 */
export const ROW_SIZE = 20;

/**
 * The square a mark answers in — the button, not the glyph inside it.
 *
 * Read from outside as well: the window's own marks are the tallest thing in
 * the band along the top of the window, so this is what that band has to clear.
 */
export const MARK_BUTTON = 24;

/**
 * How heavy every line in this file is, in pixels on the screen.
 *
 * One pixel, and the same one at every size a mark is drawn at. The weight is
 * stated here rather than in the square the paths are written in, because those
 * are two different things: the square is 24 wide whatever the mark ends up as,
 * so a stroke stated in it is a share of the drawing and lands at whatever the
 * drawing's size makes of it. That is how a folder at 20 came to be struck a
 * third heavier than a chevron at 15 — the same number, two sizes — and a set
 * of marks where the bigger ones are also the bolder ones reads as two sets.
 *
 * A hairline rather than the two-in-24 these were drawn at, which came out at a
 * pixel and a quarter: these marks sit beside names and beside a graph, and
 * neither is something a mark should be heavier than.
 */
export const HAIRLINE = 1;

/** That weight, back in the units of the square the paths are written in. */
export function struck(size: number, weight: number = HAIRLINE): number {
  return (weight * 24) / size;
}

export function Frame({
  size = SIZE,
  spill,
  children,
}: {
  size?: number;
  /**
   * Lets the drawing out of its own square.
   *
   * A mark is cut to the square it is written in, which is what keeps a run of
   * them even. Figures are not a mark: a second one of them is wider than the
   * square, and a number with its sides shaved off is a number nobody can
   * read — so it spills into the clearance every one of these carries rather
   * than being trimmed, and rather than widening the place it stands in and
   * pushing the rest of the run along. See `CliGlyph`.
   */
  spill?: boolean;
  children: React.ReactNode;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={struck(size)}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      // Written as a style rather than as an attribute: what cuts a drawing to
      // its square is the engine's own rule for the outermost `svg`, and only
      // a style is certain to outrank it everywhere this window runs.
      style={spill ? { overflow: "visible" } : undefined}
    >
      {children}
    </svg>
  );
}

/**
 * The button a mark sits in: the mark and its reach, and nothing else drawn.
 *
 * No plate, no border, no fill of its own — it takes the colour of whatever it
 * is over and keeps out of the way until it is wanted. One grey throughout: a
 * mark that is on says so by what is drawn in it, the way `ExpandMark`'s ring
 * fills, and a second colour saying the same thing would be the same thing said
 * twice.
 *
 * It says what it is once. A mark sits inside a row, and a row that carries a
 * `title` of its own hands that title to everything in it — so the pointer on a
 * mark brought up the row's own tooltip as well as the mark's. The empty
 * `title` here is what stops that: it says this element has no advisory
 * information of its own, which is what keeps the browser from going looking
 * for one further up.
 */
export function MarkButton({
  label,
  danger,
  faint,
  onClick,
  children,
  ...aria
}: {
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
  /** What the mark is, for something reading the window aloud. Never drawn:
   *  the mark is the whole of what is said, and a word beside it would be the
   *  same thing said twice. */
  label: string;
  /** Answers in red under the pointer: for the one that cannot be undone. */
  danger?: boolean;
  /** Held back until the pointer is near: for a mark standing over the canvas
   *  or in the window's own band, rather than in a row of its own. */
  faint?: boolean;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
  children: React.ReactNode;
}) {
  return (
    <Box
      component="button"
      type="button"
      aria-label={label}
      {...aria}
      onClick={onClick}
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        width: MARK_BUTTON,
        height: MARK_BUTTON,
        p: 0,
        border: "none",
        borderRadius: 1,
        background: "none",
        color: "text.secondary",
        cursor: "pointer",
        opacity: faint ? 0.45 : 1,
        transition: "opacity 90ms ease-out, color 90ms ease-out",
        "&:hover, &:focus-visible": {
          opacity: 1,
          // A mark that is already out has no fade left to answer the pointer
          // with, so the answer is the weight of the grey: one step up out of
          // the secondary text it is set in.
          color: danger ? "error.main" : "text.primary",
        },
      }}
    >
      {children}
    </Box>
  );
}

export * from "./marks/cli";
export * from "./marks/row";
export * from "./marks/tree";
export * from "./marks/window";

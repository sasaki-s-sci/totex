import { Box } from "@mui/material";

/**
 * The marks the window's own controls carry, and the button they sit in.
 *
 * Drawn here rather than taken from the icon set, and sized in pixels rather
 * than in `em`: an icon that works its size out from the font renders at
 * whatever the engine decides one em is, and this app has already been caught
 * by that — WebKit gave a glyph no size at all and left an empty disc on the
 * canvas. A path at a stated size is the same drawing in every engine.
 * `AgentIcon` makes the same argument for the marks on the graph.
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
const SIZE = 15;

/**
 * The size a mark drawn beside a name in the folder column is set at.
 *
 * The rows there carry icons from the set as well — a file, a link — and a
 * drawing of our own at the marks' own size would read as a smaller kind of
 * thing standing in the same column. This is what MUI calls
 * small, which is what those rows are already using.
 */
const ROW_SIZE = 20;

/**
 * The square a mark answers in — the button, not the glyph inside it.
 *
 * Read from outside as well: the window's own marks are the tallest thing in
 * the band along the top of the window, so this is what that band has to clear.
 */
export const MARK_BUTTON = 24;

function Frame({ size = SIZE, children }: { size?: number; children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/**
 * A line with a branch leaving it for a ring — the graph in miniature, which is
 * what expanding a folder puts on the canvas. The ring fills once it is there,
 * so the mark says the state as well as the offer.
 *
 * It is the only way onto the graph, and it sits beside every folder — a
 * folder is a place work happens whether or not there is a repository in it,
 * and one on the graph is a row with a terminal on it either way. The one on a
 * pane's heading is for the folder the pane is showing, and the one on a row is
 * for that row. Browsing never draws anything by itself, which is what keeps a
 * walk through a folder of repositories from reading all of them.
 */
export function ExpandMark({ on }: { on: boolean }) {
  return (
    <Frame>
      <path d="M3 17.5 H7.5 C13 17.5 12.5 7 17.5 7" />
      <circle cx="19.5" cy="6.6" r="2.6" fill={on ? "currentColor" : "none"} />
    </Frame>
  );
}

/**
 * The same mark with a number on it: how many repositories are in the folder.
 *
 * The count is the one thing about a folder that cannot be seen by opening it —
 * a repository may be several levels down — so it is said where the offer to
 * draw the folder is, rather than as a second mark of its own. A folder with
 * none carries the bare mark: it can still be put on the graph, and what it
 * draws there is a row with a terminal on it.
 *
 * Set over the corner the mark leaves empty, and outside the drawing rather
 * than inside it: the glyph is 15 pixels and a numeral cut to fit in it would
 * be four. The button's own square is where the room is.
 */
export function GraphMark({ on, count }: { on: boolean; count: number }) {
  return (
    <Box sx={{ position: "relative", display: "flex" }}>
      <ExpandMark on={on} />
      {count > 0 && (
        <Box
          component="span"
          sx={{
            position: "absolute",
            right: -4,
            bottom: -4,
            px: "1px",
            borderRadius: "3px",
            background: "background.default",
            fontSize: 9,
            fontVariantNumeric: "tabular-nums",
            lineHeight: 1,
          }}
        >
          {count}
        </Box>
      )}
    </Box>
  );
}

/**
 * A chevron: down over rows that are showing, right over rows that are folded
 * away. Nothing to do with the graph — this one only says whether the folder's
 * contents are on screen, which is the whole of what the heading's click does.
 */
export function DisclosureMark({ on }: { on: boolean }) {
  return (
    <Frame>
      <path d={on ? "M6 9.5 L12 15.5 L18 9.5" : "M9.5 6 L15.5 12 L9.5 18"} />
    </Frame>
  );
}

/**
 * A folder, and the same folder with its front let down.
 *
 * Hollow, like everything else drawn here: a filled block of colour is the one
 * shape in a listing that cannot be seen through, and a column of them reads as
 * a column of tabs rather than a column of names. The outline says folder just
 * as well at this size, and leaves the eye on the names.
 *
 * Shut or open is the whole of what a row's own click does, so it is the icon
 * that says it: the front panel comes down and the folder is standing open,
 * which is the same thing the rows appearing underneath it say.
 */
export function FolderMark({ on }: { on: boolean }) {
  return (
    <Frame size={ROW_SIZE}>
      {on ? (
        <>
          <path d="M2.5 18.5 V5.5 H8.5 L10.5 8 H19.5 V11" />
          <path d="M2.5 18.5 H17.5 L21.5 11 H6.5 Z" />
        </>
      ) : (
        <path d="M2.5 18.5 V5.5 H8.5 L10.5 8 H21.5 V18.5 Z" />
      )}
    </Frame>
  );
}

/** Two strokes, crossed. */
export function CloseMark() {
  return (
    <Frame>
      <path d="M6.5 6.5 L17.5 17.5 M17.5 6.5 L6.5 17.5" />
    </Frame>
  );
}

/** The same two strokes, uncrossed. */
export function AddMark() {
  return (
    <Frame>
      <path d="M12 5 V19 M5 12 H19" />
    </Frame>
  );
}

/**
 * An arrow into the far corner: the pane leaves where it is and lists this
 * folder from the top instead.
 *
 * Opening a folder and moving to it are two different things — one shows what
 * is inside it where it stands, the other makes it the folder the pane is
 * showing — so the second one is a mark of its own rather than the same click
 * meaning both. It points the opposite way to `UpMark`, which is the way back
 * out.
 */
export function JumpMark() {
  return (
    <Frame>
      <path d="M6.5 6.5 L17 17 M17 10.5 V17 H10.5" />
    </Frame>
  );
}

/**
 * An arrow into the near corner: the pane leaves this folder and lists the one
 * above it instead.
 *
 * It stands with the pane's own marks rather than as the first of its rows. A
 * row is something the folder holds, and the folder above it is not one of
 * those — where the pane is standing is the heading's business, which is where
 * the mark that moves it belongs.
 */
export function UpMark() {
  return (
    <Frame>
      <path d="M17.5 17.5 L7 7 M7 13.5 V7 H13.5" />
    </Frame>
  );
}

/**
 * Two sliders with their knobs.
 *
 * A wheel is the more usual mark for settings, but a wheel at fifteen pixels is
 * a circle with a fringe — the teeth are what make it a wheel, and they are the
 * first thing to go. Two lines and two knobs survive the size.
 */
export function SettingsMark() {
  return (
    <Frame>
      <path d="M3.5 9 H7 M12 9 H20.5 M3.5 15 H12 M17 15 H20.5" />
      <circle cx="9.5" cy="9" r="2.4" />
      <circle cx="14.5" cy="15" r="2.4" />
    </Frame>
  );
}

/** A line: the window down to the taskbar. */
export function MinimiseMark() {
  return (
    <Frame>
      <path d="M5 12 H19" />
    </Frame>
  );
}

/** The window filling the screen, or coming back off it. */
export function MaximiseMark({ on }: { on: boolean }) {
  return (
    <Frame>
      {on ? (
        <>
          <path d="M8.5 8.5 V6.5 H17.5 V15.5 H15.5" />
          <rect x="5.5" y="11.5" width="10" height="7" rx="1" />
        </>
      ) : (
        <rect x="5.5" y="5.5" width="13" height="13" rx="1.5" />
      )}
    </Frame>
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
}: {
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

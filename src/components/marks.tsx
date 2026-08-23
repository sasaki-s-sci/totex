import { Box } from "@mui/material";

import type { UpdateStage } from "../lib/update";

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
const HAIRLINE = 1;

/** That weight, back in the units of the square the paths are written in. */
function struck(size: number, weight: number = HAIRLINE): number {
  return (weight * 24) / size;
}

function Frame({ size = SIZE, children }: { size?: number; children: React.ReactNode }) {
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

/**
 * A terminal: the prompt, and the line waiting after it.
 *
 * Drawn here rather than taken from the icon set, like everything else in this
 * file, and for the reason this file exists at all — the set's terminal is a
 * filled glyph, and a filled glyph has no line to make thinner. Beside marks
 * struck at a hairline it read as the one solid thing on the canvas, which on a
 * graph where a terminal is the commonest mark there is meant the commonest
 * mark was also the loudest.
 *
 * Two strokes, and no screen round them. The set's version draws the box as
 * well, and a box is what the drawing cannot afford: these stand at eleven
 * pixels on the canvas, where the frame takes most of the square and leaves the
 * prompt inside it two pixels to be a prompt in — and a prompt that cannot be
 * read is a rounded rectangle. Without it the two strokes have the whole square
 * and the mark says the same thing, which is what a shell has looked like on
 * every screen it has ever been on.
 *
 * The chevron is the one this file draws for a folder that is shut, which is
 * why the line after it matters: `>` alone is a direction, and `>` with
 * somewhere to type is a terminal. They never stand in the same column anyway —
 * disclosure is the folder column's, this one is the canvas's and the menus'.
 *
 * Sized by whoever draws it. On the canvas these sit on the graph's own grid
 * and are the smallest thing on it; in a menu they stand at the size the rest
 * of that row is set at.
 */
export function CliMark({ size }: { size?: number }) {
  return (
    <Frame size={size}>
      <path d="M4.8 7.6 L10.4 12 L4.8 16.4" />
      <path d="M13.4 16.4 H20" />
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
 * A wheel: the rim, the eight teeth on it and the bore through the middle.
 *
 * The teeth are what make it a wheel rather than a sun, and at fifteen pixels
 * they are the first thing to go — a tooth drawn at the hairline the rest of
 * this file is drawn at lands under two pixels and reads as a ray. So they are
 * struck half again as heavy as everything around them and squared off at the
 * tip, and they start on the rim rather than clear of it: a mark that touches
 * what it belongs to is a tooth, and one that stands off it is a ray. Half
 * again rather than a number of their own, so that they follow `HAIRLINE`
 * wherever it goes.
 */
export function SettingsMark() {
  return (
    <Frame>
      <circle cx="12" cy="12" r="6.4" />
      <circle cx="12" cy="12" r="2.4" />
      {/* Eight teeth: four on the axes, four on the diagonals, each from the
          rim out to the same radius. The diagonal ends are the axis ones over
          the root of two, written out rather than computed — this is a drawing,
          and the numbers are the drawing. */}
      <g strokeWidth={struck(SIZE, HAIRLINE * 1.6)} strokeLinecap="butt">
        <path d="M12 5.6 V2.8 M12 18.4 V21.2 M5.6 12 H2.8 M18.4 12 H21.2" />
        <path d="M7.47 7.47 L5.51 5.51 M16.53 16.53 L18.49 18.49 M16.53 7.47 L18.49 5.51 M7.47 16.53 L5.51 18.49" />
      </g>
    </Frame>
  );
}

/**
 * Which of the three the window is set to: the machine's own, light, or dark.
 *
 * One mark for the three, because it is one button — the state it is in is
 * what is drawn, the way `MaximiseMark` draws which of its two moves is next.
 * A half-filled disc for the machine's own is the older mark of the three and
 * the one that says "whichever it is over there" without a word: the sun and
 * the moon are a choice, and this is the absence of one.
 */
export function ThemeMark({ mode }: { mode: "system" | "light" | "dark" }) {
  if (mode === "dark") {
    return (
      <Frame>
        <path d="M20.5 13.4 A8.6 8.6 0 1 1 10.6 3.5 A6.9 6.9 0 0 0 20.5 13.4 Z" />
      </Frame>
    );
  }

  if (mode === "light") {
    return (
      <Frame>
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.5 V4.6 M12 19.4 V21.5 M2.5 12 H4.6 M19.4 12 H21.5" />
        <path d="M5.22 5.22 L6.7 6.7 M17.3 17.3 L18.78 18.78 M17.3 6.7 L18.78 5.22 M5.22 18.78 L6.7 17.3" />
      </Frame>
    );
  }

  return (
    <Frame>
      <circle cx="12" cy="12" r="7.5" />
      {/* The lit half, filled rather than outlined: the one place a mark in
          this window is a shape and not a line, because half a disc drawn as a
          line is a disc with a rule through it. */}
      <path d="M12 4.5 A7.5 7.5 0 0 1 12 19.5 Z" fill="currentColor" stroke="none" />
    </Frame>
  );
}

/**
 * The radius the two ring marks are struck at, and the way round it.
 *
 * A circle's dash offset is counted in the length of its own outline, so the
 * circumference has to be a number here rather than a shape — it is what says
 * how much of the ring a part-finished download has filled.
 */
const RING = 7.5;
const AROUND = 2 * Math.PI * RING;

/** The turn the two waiting rings are spun at. */
const SPIN = {
  transformOrigin: "12px 12px",
  animation: "totex-mark-spin 900ms linear infinite",
  "@keyframes totex-mark-spin": { to: { transform: "rotate(360deg)" } },
  // A window that has asked for less movement gets a ring standing still,
  // which still says the same thing: three quarters of a circle is not a
  // circle, and what is missing from it is what is being waited for.
  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
} as const;

/**
 * Where the app is in replacing itself, as one mark on one button.
 *
 * Seven drawings, one press between them, the way `ThemeMark` and
 * `MaximiseMark` are one button each: an arrow down for the offer to look, a
 * ring while it is looking, a tick for nothing to do, the same ring filling as
 * the new version arrives, two arrows round a circle for the reload that
 * finishes the pages, and one arrow round a circle for the restart that
 * finishes the program. A failure is the arrow again, in red — see
 * `UpdateButton`, which is what colours it: what went wrong is not a thing this
 * window has a word for, and pressing again is the whole of what can be done
 * about it.
 *
 * The seventh is the arrow struck through: a release nothing here can take any
 * more of. The two circles are told apart by how many arrows are in them, which
 * is also how much of the app each of them replaces.
 *
 * The arrow is the download and not a version number, because the version is
 * not the point: there is one newer than this or there is not, and the mark
 * that says which is the mark that fetches it.
 */
export function UpdateMark({ stage, progress }: { stage: UpdateStage; progress: number | null }) {
  if (stage === "checking" || (stage === "fetching" && progress === null)) {
    return (
      <Frame>
        {/* Three quarters of a ring: a whole one turning is a whole one. */}
        <Box component="g" sx={SPIN}>
          <path d="M12 4.5 A7.5 7.5 0 1 1 4.5 12" />
        </Box>
      </Frame>
    );
  }

  if (stage === "fetching") {
    return (
      <Frame>
        {/* The ring it is filling, faint, so that how far along it is can be
            read against how far there is to go. */}
        <circle cx="12" cy="12" r={RING} opacity={0.3} />
        <circle
          cx="12"
          cy="12"
          r={RING}
          strokeDasharray={AROUND}
          strokeDashoffset={AROUND * (1 - (progress ?? 0))}
          // Dashes start where the outline does, which is the right-hand side.
          // Turned a quarter back so that a ring fills from the top.
          transform="rotate(-90 12 12)"
        />
      </Frame>
    );
  }

  if (stage === "current") {
    return (
      <Frame>
        <path d="M5.5 12.5 L10 17 L18.5 7" />
      </Frame>
    );
  }

  if (stage === "swapped") {
    return (
      <Frame>
        {/* Two halves of a ring chasing each other, both stopped and both with
            a head: the page going round again, which is all a reload is. */}
        <path d="M4.5 12 A7.5 7.5 0 0 1 16.6 6.1" />
        <path d="M13.9 4.1 L17 6.2 L14.9 9.3" />
        <path d="M19.5 12 A7.5 7.5 0 0 1 7.4 17.9" />
        <path d="M10.1 19.9 L7 17.8 L9.1 14.7" />
      </Frame>
    );
  }

  if (stage === "ready") {
    return (
      <Frame>
        {/* Three quarters of a ring again, but stopped and with a head on it:
            the waiting is over and the last of it is a press away. */}
        <path d="M19.5 12 A7.5 7.5 0 1 1 12 4.5" />
        <path d="M9.8 2.3 L12 4.5 L9.8 6.7" />
      </Frame>
    );
  }

  if (stage === "held") {
    return (
      <Frame>
        {/* The arrow that would have taken it, struck through: there is one,
            and it is not this copy's to have. */}
        <path d="M12 4 V14.6" />
        <path d="M7.6 10.2 L12 14.6 L16.4 10.2" />
        <path d="M5 19 H19" />
        <path d="M4.4 20.4 L19.6 5.2" />
      </Frame>
    );
  }

  return (
    <Frame>
      <path d="M12 4 V14.6" />
      <path d="M7.6 10.2 L12 14.6 L16.4 10.2" />
      {/* The line it lands on: an arrow with nothing under it is a direction,
          and this one is a thing arriving somewhere. */}
      <path d="M5 19 H19" />
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

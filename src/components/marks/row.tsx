/**
 * The marks a row or a bar carries: a terminal, an agent, a close, an add, a
 * jump, a step up, and the settings.
 */

import { Box } from "@mui/material";

import { Frame, HAIRLINE, SIZE, struck } from "../marks";

/** The cursor a terminal waits at: the one part of this mark that ever moves. */
const CARET = "M13.4 16.4 H20";

/**
 * That cursor turning over, which is what says the terminal is not waiting.
 *
 * The glyph is a chevron and the block that sits after it, which is a drawing
 * of a shell waiting to be typed at. So the part of the mark that stands for
 * the wait is the part that moves, and the chevron — which is what makes the
 * glyph a terminal at all — is left exactly where it is.
 *
 * Two half turns rather than a spin. A cursor turning steadily is a spinner,
 * and a spinner beside every busy terminal is a screen of things revolving;
 * this turns over, stops long enough to be a mark again, and turns over once
 * more. Which way up it lands is not read — a block is the same block at nought
 * and at a hundred and eighty — so the turn is the whole of the telling and the
 * rest of the cycle is the mark standing still.
 *
 * The turn is a fixed length and the stillness is what the cycle is stretched
 * with: the percentages are worked back from about a third of a second of
 * turning, so that slowing the mark down puts the extra time into the standing
 * still rather than into the movement.
 *
 * Carried on the drawing rather than in a stylesheet, the way `UpdateMark`
 * carries its own spin: this mark is drawn on the canvas and in the panel's
 * band, and an animation that lived in the canvas's own rules would be one the
 * band could only borrow. `transform` and nothing else, because it is the one
 * property the compositor can run without the canvas being redrawn.
 */
const TURN = {
  // In the square the paths are written in, rather than in the box this one
  // stroke happens to fill: a horizontal line has no height, so the middle of
  // its own bounds is a place the drawing does not have.
  transformBox: "view-box",
  transformOrigin: "16.7px 16.4px",
  animation: "totex-cli-caret 5.4s cubic-bezier(0.4, 0, 0.2, 1) infinite",
  "@keyframes totex-cli-caret": {
    "0%": { transform: "rotate(0deg)" },
    "6.7%, 50%": { transform: "rotate(180deg)" },
    "56.7%, 100%": { transform: "rotate(360deg)" },
  },
  // A window that has asked for less movement gets the mark it has always had,
  // which still says what it says: what is running is also on the terminal's
  // own screen, one press away.
  "@media (prefers-reduced-motion: reduce)": { animation: "none" },
} as const;

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
 *
 * `working` is for the ones that are a terminal rather than an offer to open
 * one: it turns the cursor over and leaves the rest of the mark where it is.
 * A prop rather than a class hung on whatever the mark is sitting in, because
 * the same mark is drawn on the canvas and in the panel's band and the two have
 * no container in common — see `CliGlyph`, which is what both of them draw.
 */
export function CliMark({ size, working }: { size?: number; working?: boolean }) {
  return (
    <Frame size={size}>
      <path d="M4.8 7.6 L10.4 12 L4.8 16.4" />
      {working ? <Box component="path" sx={TURN} d={CARET} /> : <path d={CARET} />}
    </Frame>
  );
}

/**
 * Three points joined: what stands in a terminal's place while an agent is
 * running in it.
 *
 * A terminal running an agent is not a terminal somebody is waiting on. The
 * glyph beside it says `a shell, and a command in it` — a chevron to type after
 * — and that is the wrong thing to say about a session somebody is having, so
 * the whole mark changes rather than something being hung off it.
 *
 * Points and the lines between them rather than a face or a star. It is drawn
 * at eleven pixels in a stack of other marks at eleven pixels: an eye in a
 * drawing that small is a pixel, and a pixel is not a feature. Three dots and
 * three strokes hold their shape all the way down, and they are the same
 * hairline everything else in this file is struck at.
 */
export function AgentMark({ size }: { size?: number }) {
  return (
    <Frame size={size}>
      <circle cx="12" cy="5.6" r="2.6" />
      <circle cx="5.6" cy="17.4" r="2.6" />
      <circle cx="18.4" cy="17.4" r="2.6" />
      {/* Rim to rim rather than centre to centre: a stroke run under a circle
          is a stroke drawn twice at the hairline, and at eleven pixels that is
          a blot where a point should be. */}
      <path d="M10.76 7.89 L6.84 15.11 M13.24 7.89 L17.16 15.11 M8.2 17.4 H15.8" />
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

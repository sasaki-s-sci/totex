/**
 * The marks a row or a bar carries: a terminal, an agent, a close, an add, a
 * jump, a step up, and the settings.
 */

import { Frame, HAIRLINE, SIZE, struck } from "../marks";

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
export function CliMark({ size }: { size?: number }) {
  return (
    <Frame size={size}>
      <path d="M4.8 7.6 L10.4 12 L4.8 16.4" />
      {/* The cursor a terminal waits at. Named because it is the one part of
          any mark in this file that moves: a session with something running in
          it turns this over and leaves the chevron where it is — see
          `.is-working` beside the terminal marks. The class is on the drawing
          rather than a prop on the mark, because what is running is a fact
          about a session and this mark is drawn in four places, three of which
          are an offer to open one rather than one that is open. */}
      <path className="cli-mark__caret" d="M13.4 16.4 H20" />
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
      {/* Grouped so that the three points and the lines between them turn as
          one drawing. The turn is the mark's, not a state hung on it: this mark
          is only ever drawn where an agent is running, so what it says and what
          it does are the same statement -- see `.agent-mark`. */}
      <g className="agent-mark">
        <circle cx="12" cy="5.6" r="2.6" />
        <circle cx="5.6" cy="17.4" r="2.6" />
        <circle cx="18.4" cy="17.4" r="2.6" />
        {/* Rim to rim rather than centre to centre: a stroke run under a circle
            is a stroke drawn twice at the hairline, and at eleven pixels that is
            a blot where a point should be. */}
        <path d="M10.76 7.89 L6.84 15.11 M13.24 7.89 L17.16 15.11 M8.2 17.4 H15.8" />
      </g>
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

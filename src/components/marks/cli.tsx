/**
 * One terminal, drawn as what it is doing — or as the number that reaches it.
 */

import type { Doing } from "../../lib/doing";
import { Frame } from "../marks";
import { AgentMark, CliMark } from "./row";

/**
 * The size a terminal is struck at wherever a run of them is read.
 *
 * The stack on the canvas and the strip in the panel's band are two readings of
 * one thing, so they are one size as well as one drawing: a band of smaller
 * terminals beside a canvas of larger ones reads as two kinds of terminal.
 */
export const CLI_GLYPH = 11;

/**
 * The figures, in the units of the square every mark in this set is written in.
 *
 * Placed rather than left to a baseline keyword. `dominant-baseline` is the one
 * part of SVG text the engines this app runs in do not agree on, and half a
 * pixel out is exactly what these two lines are here to stop: the figures hang
 * off the alphabetic baseline like any other text, and that baseline is put
 * half a figure's height below the middle of the square — which puts the middle
 * of the figures on the middle of the mark, and so on the middle of every other
 * mark in the run.
 *
 * `CAP` is how tall a figure stands in the face the window is set in, as a
 * share of its own size. It is a property of the face rather than a number to
 * be tuned: system-ui on the desktops this runs on is around seven tenths, and
 * a face where it is not is a face where the figures are a shade high or low
 * rather than one where they land somewhere else.
 */
const NUMBER = 19.5;
const CAP = 0.7;
const BASELINE = 12 + (NUMBER * CAP) / 2;

type Props = {
  /** What is running in it, or null while nothing has been heard about it. */
  doing: Doing | null;
  /** The number that reaches it, drawn in place of the glyph while there is one. */
  jump?: number | null;
  size?: number;
};

/**
 * What a terminal looks like, in the one place it is decided.
 *
 * Three drawings and one number. An agent wears a mark of its own, a command
 * running turns the terminal's cursor over, a shell at its prompt is the
 * terminal exactly as it is drawn everywhere else — and over all three, while
 * something is asking, the number that would reach this one.
 *
 * Two of the four states are the same drawing: an agent is an agent whether it
 * is answering or waiting to be answered, so what tells those two apart is the
 * mark turning rather than a mark of its own. Which is the same thing the
 * terminal's own glyph does for a command that is running — see `CliMark`.
 *
 * The number stands in place of the glyph rather than beside it: on the canvas
 * while Ctrl is held, and in the panel's band for the terminal the panel is
 * holding. Both times it is the same number, and both times it is the whole of
 * what the mark has to say while it is there — a mark carrying both would be
 * saying the one thing anybody already knows about it, that it is a terminal,
 * next to the one thing they are looking for.
 *
 * It is struck on the mark's own square, which is what keeps a run of these
 * still: the figures land on the same centre the glyphs do, and a second figure
 * widens the number into the clearance round it rather than widening the place
 * it is standing in — nothing to either side of it moves.
 *
 * Nothing here is a colour. Which of these the panel is holding is said by the
 * ink the mark is handed — see `.cli__open.is-showing` on the canvas and the
 * strip in the band — and a second thing said in colour would be two things
 * said in one place.
 */
export function CliGlyph({ doing, jump = null, size = CLI_GLYPH }: Props) {
  if (jump !== null) {
    return (
      <Frame size={size} spill>
        <text
          x="12"
          y={BASELINE}
          textAnchor="middle"
          fill="currentColor"
          stroke="none"
          fontSize={NUMBER}
          fontWeight={600}
          // So that 1 and 11 stand in the same place, and a run does not
          // shuffle as the panel moves from one terminal to the next.
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {jump}
        </text>
      </Frame>
    );
  }

  if (doing === "agent" || doing === "working") {
    return <AgentMark size={size} working={doing === "working"} />;
  }

  return <CliMark size={size} working={doing === "running"} />;
}

import type { Node } from "@xyflow/react";

import type { Report } from "../mcp";
import type { Session } from "../session";
import { clamp, wrap } from "./asking";

/**
 * The card a session's own account of itself is drawn in, and the room it takes.
 *
 * The other of the two things a terminal can have standing beside it. A
 * question is a turn nobody has taken; this is the opposite — nothing is
 * waiting, the agent is working, and this is what it says it is working on. So
 * it is the same card, in the same column, at the same width: from across the
 * canvas the shape says "there is something to read beside this terminal", and
 * what kind of something is read at the card rather than guessed at from its
 * outline. See `asking`, which is where that shape and the room it takes are
 * written down.
 *
 * Never both at once. A session that has stopped to ask is drawn asking, and
 * whatever it said it was doing a moment before that is the less useful of the
 * two things it could be saying — see `build`, which is where the two meet.
 *
 * Measured here rather than where it is drawn, for the reason every card in
 * this app is: the canvas has to know how tall it is before it can place it,
 * and a box laid out from text nobody measured is a box that clips its own last
 * line.
 */

/** The card's own inset, and the parts it is built from, in canvas units. */
const PAD = 9;
const HEAD = 15;
const SPLIT = 7;
const DOING_LINE = 15;
const STEP_LINE = 14;
/** The line round the card. */
const BORDER = 2;

/**
 * How many columns of each kind of text a card holds.
 *
 * Columns rather than pixels, the same as a question's: what a card shows came
 * from a terminal, where a character is a cell and a Japanese character is two
 * of them. A step is set narrower than the line above it because the mark that
 * says whether it is finished stands in front of it.
 */
const DOING_CELLS = 36;
const STEP_CELLS = 32;

/**
 * How much of it is drawn.
 *
 * A card is a glance, not a plan: three lines of what is happening, and four
 * steps of the list it belongs to. The count in the corner is what says how
 * much of the list is not being shown — which is the one thing about the rest
 * of it worth knowing from here.
 */
const DOING_LINES = 3;
const STEP_ROWS = 4;

/** One step, as it is drawn: cut to width, and marked. */
export type CardStep = {
  /**
   * Where it stands in the whole plan, counting from zero.
   *
   * What tells one row from another. The titles are the agent's own and two of
   * them can say the same thing, and the four rows drawn are a window onto a
   * longer list that slides as the work goes on — so a row is named by its
   * place in the plan rather than by its place on the card.
   */
  at: number;
  title: string;
  done: boolean;
  /** The one being worked on, which is the first that is not finished. */
  here: boolean;
};

/** A report, measured and cut to the card it is drawn in. */
export type ReportCard = {
  /** Already broken to width and cut to length, the cut marked by an ellipsis. */
  doing: string[];
  steps: CardStep[];
  /** How much of the plan is done, or nothing where there is no plan. */
  count: string | null;
  /** How tall the card comes out, which is what the canvas is measured from. */
  height: number;
};

export type ReportNodeData = {
  /** The session it is about, which is what the head of the card opens. */
  session: Session;
  /** What it said, as it said it. */
  report: Report;
  card: ReportCard;
};

export type ReportFlowNode = Node<ReportNodeData, "report">;

/** The report as the card will draw it, and how tall that makes the card. */
export function reportCard(report: Report): ReportCard {
  const doing = clamp(wrap(report.doing, DOING_CELLS), DOING_LINES);

  // Which step is in hand is a fact about the whole list rather than about the
  // four of it that are drawn, so it is found in the list and carried into the
  // window from there.
  const working = report.steps.findIndex((step) => !step.done);
  const first = from(report);
  const steps = report.steps.slice(first, first + STEP_ROWS).map((step, at) => ({
    at: first + at,
    title: clamp(wrap(step.title, STEP_CELLS), 1)[0] ?? "",
    done: step.done,
    here: first + at === working,
  }));

  const done = report.steps.filter((step) => step.done).length;
  const count = report.steps.length > 0 ? `${done}/${report.steps.length}` : null;

  // The border is the card's as much as its padding is — see the stylesheet,
  // which pairs every number here with a rule.
  let height = BORDER + PAD + HEAD + PAD;
  if (doing.length > 0) height += SPLIT + doing.length * DOING_LINE;
  if (steps.length > 0) height += SPLIT + steps.length * STEP_LINE;

  return { doing, steps, count, height };
}

/**
 * Where the steps that are drawn begin.
 *
 * The one in hand, the one before it, and the ones after: a list read from the
 * top would show four finished steps and none of the work, and one read from
 * the bottom would show where it is going and not where it has got to.
 */
function from(report: Report): number {
  if (report.steps.length <= STEP_ROWS) return 0;
  const working = report.steps.findIndex((step) => !step.done);
  if (working < 0) return report.steps.length - STEP_ROWS;
  return Math.min(Math.max(working - 1, 0), report.steps.length - STEP_ROWS);
}

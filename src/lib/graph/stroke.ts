/**
 * Every line the graph draws: where its two ends are, and what it is stroked
 * with.
 */

import { COLUMN_WIDTH, COMMIT_STEP, LANE_HEIGHT, LINE_COLOR } from "./grid";
import { CLI_STEP, SESSION_WIDTH } from "./stacks";

export type GraphLine = {
  id: string;
  from: LineEnd;
  to: LineEnd;
  /** A line that changes rows takes the S; one that stays in its row is straight. */
  curve: boolean;
  /** How far short of the far end to stop, for a line that runs into a ring. */
  trim: number;
  /** How far out from the near end to start, for a line that leaves a box. */
  lead: number;
  /** How it is drawn, which is also what it is batched by. */
  stroke: StrokeStyle;
  /** The branch name set along it, for the few lines that carry one. */
  name?: Label;
};

/**
 * Where a line ends: the node it belongs to, and the middle of that node.
 *
 * The offset is the node's own half-box rather than a point on the canvas, so
 * the end follows the mark wherever the mark happens to be standing.
 */
export type LineEnd = {
  /** The node whose mark this end sits on. */
  node: string;
  dx: number;
  dy: number;
};

/**
 * The end of a line that sits on a cell's own mark.
 *
 * A branch head, a folded repository, a folder's row: each takes a whole cell
 * and its mark is in the middle of it, so a line into one ends half a cell
 * along and half a cell down from wherever that node is standing.
 */
export function onCell(node: string): LineEnd {
  return { node, dx: COLUMN_WIDTH / 2, dy: LANE_HEIGHT / 2 };
}

/**
 * And the end of one that sits on a commit's mark, which is the same thing on
 * the history's own grid.
 */
export function onCommit(node: string): LineEnd {
  return { node, dx: COMMIT_STEP.x / 2, dy: COMMIT_STEP.y / 2 };
}

/**
 * A point inside a band, in the band's own coordinates.
 *
 * What a line into a row ends on: a row is a height rather than a node, and the
 * band is the one thing on the canvas whose position is its own — every chip
 * and every commit in it is placed relative to this.
 */
export function inBand(band: string, x: number, y: number): LineEnd {
  return { node: band, dx: x, dy: y };
}

/**
 * The middle of a terminal's mark, which is where its lines leave and where the
 * line from its branch arrives.
 */
export function onStack(node: string): LineEnd {
  return { node, dx: SESSION_WIDTH / 2, dy: CLI_STEP / 2 };
}

/**
 * A branch's name, set along the line that runs out to it.
 *
 * Cut to length and placed here rather than where it is drawn: how much of a
 * name fits is a sum about the line's length, and the canvas should be handed
 * the answer rather than the question.
 */
export type Label = {
  /** The whole name, which is what the tooltip says. */
  full: string;
  /** As much of it as the line has room for. */
  text: string;
  /** How far along the line it is set, as a fraction. */
  at: number;
};

/** What a line looks like. Lines that match are drawn as one path. */
export type StrokeStyle = {
  colour: string;
  width: number;
  opacity: number;
  dash?: string;
};

/**
 * A terminal, joined to the branch it is running in.
 *
 * One colour for every one of them, because they are one kind of thing: a
 * terminal in a directory. What is being run inside it is not this canvas's
 * to know — the window opened a shell, and what somebody types into it is
 * theirs — so a colour that named it would be a colour naming a guess.
 *
 * Every line into this column is one of these: what a branch could be running
 * and is not is said by the button on its ring, and a dashed line out to a mark
 * holding a place open was the canvas drawing something that had not happened.
 */
export const CLI_STROKE: StrokeStyle = {
  colour: "var(--mui-palette-text-disabled)",
  width: 1.0,
  opacity: 0.7,
};

/**
 * A folder, joined to each of the repositories it holds.
 *
 * The one line on the canvas that says what is inside what rather than what
 * came from what, and the reason a folder is drawn at all: a directory holding
 * a dozen repositories is a dozen of these leaving one mark, and the group is
 * read as one thing because they all start in the same place.
 *
 * Faint, and in the canvas's own ink. Containment is the quietest fact on the
 * graph — it does not change, and nothing is done about it — so these lines are
 * the ground the rest of the group is read against rather than anything to be
 * followed.
 */
export const FOLDER_STROKE: StrokeStyle = {
  colour: LINE_COLOR,
  width: 1.0,
  opacity: 0.45,
};

/**
 * A line the pointer can reach, and what it would do.
 *
 * Only history carries this: a stretch of line is the offer to fold away
 * everything behind it, which is the one thing on the canvas that is a line
 * rather than a mark. The rest of the lines are drawing and nothing else, and a
 * line that answers to the pointer is a line the canvas cannot be dragged by.
 */

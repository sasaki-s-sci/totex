/**
 * The stack of terminals a row carries, and the room it asks that row for.
 */

import { COMMIT_STEP, gridRows, LANE_HEIGHT } from "./grid";

/**
 * The box one terminal's mark is drawn in: the terminal itself, the count of
 * what it is carrying, and — for this window's own — the mark that ends it.
 *
 * A third of a cell. The mark inside it is centred and is the glyph on its own,
 * so the box is room rather than shape: what it holds is the two small marks
 * that hang either side of the terminal, and they hang there whether or not
 * this particular terminal has them.
 */
export const SESSION_WIDTH = 38;
/**
 * How much room the terminal glyph takes, which is what a line into one stops
 * short of.
 *
 * There is no box drawn round it any more — the mark is the glyph and nothing
 * else — so this is the glyph's own size with a little clearance round it,
 * rather than the size of a border somebody could see. A line run to the middle
 * would be a line drawn through the terminal, and there is no paper over it now
 * to hide that.
 */
export const CLI_MARK = 16;
/**
 * How far apart the marks hanging off a branch stand.
 *
 * Half a cell, which is a column of the history: nothing out here is words —
 * what hangs off a branch is whatever is running in it, marks the size of a
 * chip — so it is spaced the way the marks of the history are.
 *
 * It was a third of a cell, which stood the stack close enough to its branch
 * that the line between them read as a join rather than as a run out to a
 * column of its own — and the stack is a column of its own, which is the whole
 * reason it is out here rather than beside the head. The room is only ever a
 * corridor: everything between the branches and the terminals is what the lines
 * into that column sweep through, so nothing is drawn in it, and a mark
 * standing out in the middle of it would be a mark those lines cross.
 */
export const CHIP_STEP = 66;
/**
 * How far apart two terminals stand in the stack hanging under a branch.
 *
 * Denser than a lane, and deliberately: a row of the grid is the distance two
 * lines of development have to be apart to be told apart, and terminals are not
 * lines of development. They are a list of what is running in one branch,
 * stacked in the order they were started, and a list reads better tight than
 * spread — a lane apiece put four terminals down the whole height of a
 * repository.
 */
export const CLI_STEP = 34;
/**
 * How far a stack of this many marks reaches past its branch's own line, either
 * way.
 *
 * The stack is centred on the branch rather than hung under it: a branch is one
 * place, and everything running in it belongs to that place equally, so the
 * marks open out from the branch's line instead of trailing away from it. A
 * stack of one — a branch running a single terminal — reaches nowhere and
 * stands exactly on the line, and a branch running nothing has no stack: the
 * room for one more is the button on the branch's own ring, not a mark out
 * here holding a place open.
 *
 * The room this asks for is therefore split between the row above and the row
 * below, which is why spacing two rows needs the depth of both — see
 * `rowPitch`, which spaces a folder's own column, and `branchPitch`, which is
 * the same sum on the tighter grid a band's branches are dealt onto.
 */
export function stackReach(marks: number): number {
  return ((marks - 1) * CLI_STEP) / 2;
}
/**
 * How far a row outside a band reaches from its own line, either way.
 *
 * A lane, or its stack where that is deeper. What a column is measured by at
 * its two ends — the first row and the last, of a folder's own column or of the
 * branches down a band — where there is no neighbour to share the room with.
 */
export function rowReach(marks: number): number {
  return gridRows(Math.max(LANE_HEIGHT / 2, stackReach(marks) + CLI_STEP / 2));
}
/**
 * How far apart the lines of two neighbouring rows stand, given what each of
 * them is running.
 *
 * A folder's repositories are spaced by this, and its branches by the same sum
 * a lane at a time — see `branchPitch` — because they are the same shape: a
 * stack is centred on its row's own line, so the room it takes is split between
 * the row above and the row below, and the gap between two rows is a sum over
 * both of their stacks. A lane holds a row and one terminal without any of that
 * showing, which is what `CLI_CLEAR` says a lane has spare, so nothing moves
 * until something is running two at once.
 */
export function rowPitch(above: number, below: number): number {
  return gridRows(Math.max(LANE_HEIGHT, reachOf(above) + reachOf(below) + CLI_CLEAR));
}
/**
 * How far apart two neighbouring lanes of a band's branch column stand.
 *
 * The same sum as `rowPitch`, on the half-lane grid the branches are dealt
 * onto: a branch is a name pointing into the history rather than a line of
 * development of its own, so its lanes are packed as tightly as the commit rows
 * beside them and every one of them stands on the same lattice.
 *
 * Half a lane holds a branch and the one terminal running in it without any of
 * that showing — a stack of one stands exactly on the branch's own line. A
 * second terminal opens the stack out either way, and the lanes above and below
 * it drop a whole grid row apiece rather than sliding to wherever the marks
 * happen to fit: what moves a branch is visible as a row of the grid, and the
 * branches go on being read down the same lattice as the history.
 *
 * The clearance is a step of the stack itself, so the marks that meet across a
 * boundary stand no closer than the marks within one branch's stack do.
 */
export function branchPitch(above: number, below: number): number {
  return gridRows(Math.max(COMMIT_STEP.y, reachOf(above) + reachOf(below) + CLI_STEP));
}
/** How far a row's stack reaches past its own line, for a row that has one. */
function reachOf(marks: number): number {
  return marks > 1 ? stackReach(marks) : 0;
}
/**
 * How much room is left between the last mark of one branch's stack and the
 * first mark of the next branch's.
 *
 * The difference between a lane and a step, which is what a lane has to spare
 * once a branch and one terminal are standing in it: two branches each running
 * one terminal reach half a step towards each other and still leave this much
 * between the marks that meet. Every mark past that buys its own room, half
 * from the row above and half from the row below, and the marks either side of
 * the boundary end up about a step apart like the rest of the stack.
 */
export const CLI_CLEAR = LANE_HEIGHT - CLI_STEP;

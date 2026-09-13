import { COMMIT_STEP, gridRows, LANE_HEIGHT } from "./grid";

export const SESSION_WIDTH = 38;
/** The glyph with clearance; there is no box for a line to hide under. */
export const CLI_MARK = 16;
/** Half a cell: the corridor between branches and terminals is swept by lines. */
export const CHIP_STEP = 66;
export const CLI_STEP = 34;

// A stack is centred on its branch line, so its room is split between the
// rows above and below; spacing two rows sums both stacks.
export function stackReach(marks: number): number {
  return ((marks - 1) * CLI_STEP) / 2;
}
export function rowReach(marks: number): number {
  return gridRows(Math.max(LANE_HEIGHT / 2, stackReach(marks) + CLI_STEP / 2));
}
export function rowPitch(above: number, below: number): number {
  return gridRows(Math.max(LANE_HEIGHT, reachOf(above) + reachOf(below) + CLI_CLEAR));
}
// Same sum on the half-lane grid branches are dealt onto.
export function branchPitch(above: number, below: number): number {
  return gridRows(Math.max(COMMIT_STEP.y, reachOf(above) + reachOf(below) + CLI_STEP));
}
function reachOf(marks: number): number {
  return marks > 1 ? stackReach(marks) : 0;
}
/** What a lane has spare once a branch and one terminal stand in it. */
export const CLI_CLEAR = LANE_HEIGHT - CLI_STEP;

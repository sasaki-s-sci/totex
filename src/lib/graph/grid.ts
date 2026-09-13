// The grid the graph is laid out on. Node centres always stand on a vertex;
// history rows pack into half a lane because they carry no words.

export const COLUMN_WIDTH = 100;
export const LANE_HEIGHT = 100;
export const COMMIT_STEP = { x: COLUMN_WIDTH, y: LANE_HEIGHT / 2 };

/** Rounds room asked for up to whole grid rows, so nothing lands off-grid. */
export function gridRows(value: number): number {
  return Math.ceil(value / COMMIT_STEP.y) * COMMIT_STEP.y;
}

export function gridMove(value: number, axis: "x" | "y"): number {
  const step = COMMIT_STEP[axis];
  return Math.round(value / step) * step;
}
export const DOT_SIZE = 14;
// Edges end at the circle, not its centre: a provisional dashed ring would
// otherwise show the line through it.
export const COMMIT_TRIM = DOT_SIZE / 2;
export const JUNCTION_SIZE = 10;
export const JUNCTION_TRIM = JUNCTION_SIZE / 2 + 1;
// The fold is a translucent pill about two cells wide; lines start at its edge.
export const FOLD_TRIM = 29;
export const STEP = { x: COLUMN_WIDTH, y: LANE_HEIGHT };
export const HEAD_SIZE = 14;
// Slightly larger so both controls stay reachable when local and remote share a point.
export const REMOTE_HEAD_SIZE = 18;
// The extra pixel keeps the antialiased line end off the ring's own stroke.
const RING_EDGE_GAP = 1;
export const RING_TRIM = HEAD_SIZE / 2 + RING_EDGE_GAP;
export const REMOTE_HEAD_TRIM = REMOTE_HEAD_SIZE / 2 + RING_EDGE_GAP;

// `pointerEvents` lives here because React Flow lays the node's own style over
// the `pointer-events` it writes; the CSS gives the pointer back to the mark.
export const CELL_STYLE = {
  width: COLUMN_WIDTH,
  height: LANE_HEIGHT,
  pointerEvents: "none",
} as const;
export const COMMIT_CELL = {
  width: COMMIT_STEP.x,
  height: COMMIT_STEP.y,
  pointerEvents: "none",
} as const;
export const HEAD_CELL = COMMIT_CELL;
export const MIN_BAND_WIDTH = 240;
/** The line above a mark that its name is set on. */
export const NAME_HEIGHT = LANE_HEIGHT / 2;
export const REPO_GAP_Y = COMMIT_STEP.y * 2;
export const FOLDER_INSET = COLUMN_WIDTH;
export const FOLDER_MARK = 22;
export const REPO_MARK_WIDTH = COLUMN_WIDTH;
export const REPO_MARK_RING = 14;
export const FOLDER_GAP_Y = COMMIT_STEP.y;
export const DEFAULT_VISIBLE_COMMITS = 3;

// One colour for every line and mark; the stylesheet holds the same value for
// the marks CSS draws under the cursor.
export const LINE_COLOR = "var(--line)";

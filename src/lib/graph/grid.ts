/**
 * The grid the graph is laid out on, and every measure taken from it.
 *
 * Nothing here reads a repository or decides where anything goes — that is
 * `history` and `branches` for what one repository holds, `layout` for the band
 * it is drawn in, and `build` for the canvas they all share.
 */

/**
 * One cell of the grid the named things are drawn on: a repository's name, a
 * branch head, a folder's row, a repository folded into a single mark.
 *
 * Wide, because what stands in a cell is words as often as it is a mark, and a
 * name has to be read. History uses the same horizontal rhythm so the branch
 * name on its final edge has room; only its rows pack into half a lane. See
 * `COMMIT_STEP`.
 */
export const COLUMN_WIDTH = 100;
/**
 * Vertical distance between two rows of that grid, and the height of one cell.
 *
 * Two vertical grid steps. A row needs one step of clearance above and below
 * its centre, while the node centres themselves stay on the 50px lattice.
 */
export const LANE_HEIGHT = 100;
/**
 * The grid the history itself is drawn on: a full named column across and half
 * a lane down.
 *
 * History runs left to right — a commit sits one column past the last of its
 * parents, so the oldest owns the leftmost column and a branch grows out of the
 * very commit it was cut from — and down the page a row per line of
 * development. A branch name is set on the last of these runs, so every run has
 * the same full-column width: the gap from commit to commit and from the last
 * commit to its branch head never changes when a larger ring is added at the
 * end. Rows remain half a lane apart because none of them carries words.
 */
export const COMMIT_STEP = { x: COLUMN_WIDTH, y: LANE_HEIGHT / 2 };

/**
 * Moves a measurement out to the next horizontal graph line.
 *
 * Content can ask for any amount of room, but node centres may only stand on a
 * grid vertex. Layout uses this at every place where dynamic content can push a
 * row, so adding a workspace stack changes how many grid rows are skipped and
 * never introduces an off-grid coordinate.
 */
export function gridRows(value: number): number {
  return Math.ceil(value / COMMIT_STEP.y) * COMMIT_STEP.y;
}

/** The nearest grid-preserving movement of a whole graph group. */
export function gridMove(value: number, axis: "x" | "y"): number {
  const step = COMMIT_STEP[axis];
  return Math.round(value / step) * step;
}
export const DOT_SIZE = 14;
/**
 * Where an edge touching a commit ends.
 *
 * Edges used to run to the centre and rely on the solid dot to paint over
 * them. That fails as soon as the same commit is drawn as a provisional dashed
 * ring. Ending at the circle itself keeps both readings clear.
 */
export const COMMIT_TRIM = DOT_SIZE / 2;
/**
 * The knot a group of branches is gathered at.
 *
 * Half a commit, and deliberately the smallest mark the canvas draws. A commit
 * is the least thing on here that is real — an object in the repository, with a
 * message and a hand behind it — and a junction is none of that: it is the
 * shared start of some names, drawn because a dozen lines saying `dev/` before
 * they say anything else read better gathered than fanned. Smaller than the
 * least real thing is what says so without a word.
 */
export const JUNCTION_SIZE = 7;
export const JUNCTION_TRIM = JUNCTION_SIZE / 2 + 1;
/**
 * Where a line touching the fold begins.
 *
 * The fold is a pill about twice the width of a commit's cell, centred on its
 * own grid point, and its background is translucent: a line run to the middle
 * of it would be seen through it. Every line out of the fold — the dash into
 * the history, and the branches standing behind it — starts here instead.
 */
export const FOLD_TRIM = 29;
/** One step of the row grid, for anything drawn to the scale of the layout. */
export const STEP = { x: COLUMN_WIDTH, y: LANE_HEIGHT };
/** A compact local/workspace ref node. It contains no duplicate commit dot. */
export const HEAD_SIZE = 14;
/** A remote ref node. Its small extra radius keeps both controls reachable when
 *  local and remote nodes occupy exactly the same grid point. */
export const REMOTE_HEAD_SIZE = 18;
/**
 * How far short of a hollow mark a line has to stop.
 *
 * A head and the offer of a branch are rings with the canvas showing through
 * them, so a line drawn to the middle of one is drawn across the hole. It ends
 * just clear of the outer rim instead. The extra pixel keeps the antialiased
 * edge and the ring's own stroke from sharing the same screen pixels.
 */
const RING_EDGE_GAP = 1;
export const RING_TRIM = HEAD_SIZE / 2 + RING_EDGE_GAP;
export const REMOTE_HEAD_TRIM = REMOTE_HEAD_SIZE / 2 + RING_EDGE_GAP;

/**
 * One full-height cell used by named rows outside history.
 *
 * The cell itself takes no pointer: only its mark does, and the CSS gives it
 * back there. A cell is most of a column wide, so a cell that answered to the
 * cursor would cover the lines either side of the mark — and those carry the
 * fold button now — as well as swallowing the drag that pans the canvas.
 * React Flow writes `pointer-events` onto the node itself and then lays the
 * node's own style over it, which is why this belongs here and not in the
 * stylesheet.
 */
export const CELL_STYLE = {
  width: COLUMN_WIDTH,
  height: LANE_HEIGHT,
  pointerEvents: "none",
} as const;
/**
 * One node cell on the history grid: a full named column across and half a
 * lane down. Commits and branch heads share it, so their centres stay on the
 * same vertices and the first row does not get a one-sided 100px box.
 *
 * Shared and pointerless for the same reasons — there is one of these per
 * commit and the canvas holds thousands of them, and what answers the cursor is
 * the dot in the middle rather than the room around it.
 */
export const COMMIT_CELL = {
  width: COMMIT_STEP.x,
  height: COMMIT_STEP.y,
  pointerEvents: "none",
} as const;
export const HEAD_CELL = COMMIT_CELL;
/** Enough that a repository with almost no history is still read as a band and
 *  not as a mark with a line into it. */
export const MIN_BAND_WIDTH = 240;
/**
 * The room a name is set in, on the line above the mark it belongs to.
 *
 * Half a lane, which is the air a row of the grid already carries over its own
 * line. A folder's name stands over the mark that is the folder, and a
 * repository's over the mark its band opens with — the first commit drawn, or
 * the fold standing in for the history behind it — so a name is read on the way
 * into the thing it names rather than off to one side of it, and neither of
 * them takes a column of the grid away from what it heads.
 */
export const NAME_HEIGHT = LANE_HEIGHT / 2;
/** Vertical air between repository bands: two graph rows. */
export const REPO_GAP_Y = COMMIT_STEP.y * 2;
/**
 * How far a folder's repositories are set in from the folder itself.
 *
 * A whole cell, so that the folder's own mark stands clear to the left of
 * everything it holds and the line out to each of them has somewhere to run.
 * The eye runs down one edge: every repository in a folder begins at this
 * column, whether it is folded into a single mark or opened out into a band.
 */
export const FOLDER_INSET = COLUMN_WIDTH;
/**
 * The square the folder's own mark answers in, at the head of its row.
 *
 * The one thing on the row that is the folder itself: the lines out to the
 * repositories leave it, and it is what the whole group is dragged by. Small
 * enough to sit inside a row of the grid, large enough to be aimed at.
 */
export const FOLDER_MARK = 22;
/**
 * One repository folded into a single mark, on a row of its own.
 *
 * A cell of the grid, the way a commit takes one: the name, and then the ring
 * that stands for the whole of the history behind it. A folded repository is a
 * row like an opened one — the folder's line arrives at its name from the left,
 * and whatever is running in it stands past its ring on the right — so the two
 * read down the same column and folding one changes what is drawn rather than
 * where anything is.
 */
export const REPO_MARK_WIDTH = COLUMN_WIDTH;
/**
 * How far the ring on a folded repository sits from the right edge of its cell.
 *
 * On the right, with the name set at the left of the cell where the folder's
 * own line arrives: the row is read the way a band is — the name, then the
 * thing itself, then what is running in it — and a repository folded away keeps
 * its terminals in the same column of the row that an opened one does.
 */
export const REPO_MARK_RING = 14;
/** How far a folder's repositories are set below the row that heads them. */
export const FOLDER_GAP_Y = COMMIT_STEP.y;
/**
 * How much history a repository shows before it is asked to show more.
 *
 * A graph is for seeing the shape of what is going on now; three commits is
 * enough to show where each line is without a year of history pushing the
 * branches off the side of the canvas.
 */
export const DEFAULT_VISIBLE_COMMITS = 3;

/**
 * Every line on the canvas, in the one colour.
 *
 * Lines are structure, and structure is not identity: which line is which is
 * said by where it goes and by the mark at the end of it. A hue per lane drawn
 * across a repository with a score of branches read as bunting and made the
 * marks — which are the part worth looking at — compete with the wiring between
 * them.
 *
 * The marks are the one colour too, and nothing here decides it: a commit, a
 * branch ring and a folded repository are all the canvas's own ink, held by the
 * stylesheet as `--mark` — which is where the whole of that reading is written.
 * So no node below carries a colour of its own, and the only colours this file
 * still names are the ones that name a thing rather than a position: what is
 * running somewhere, and what is going on in a checkout.
 *
 * The stylesheet holds this value too, because the marks the cursor brings out
 * — the offer on a commit, the fold on a line — are drawn by CSS rather than
 * from a layout.
 */
export const LINE_COLOR = "var(--line)";

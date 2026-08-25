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
 * name has to be read. The history is not drawn on this grid — it is dots and
 * the lines between them, and it packs into half of it; see `COMMIT_STEP`.
 */
export const COLUMN_WIDTH = 132;
/**
 * Vertical distance between two rows of that grid, and the height of one cell.
 *
 * Tighter than the horizontal step: a row only has to be told apart from the one
 * above it, while a name set along a line needs room to be read in. Every row a
 * branch takes costs this much band, so keeping it down is what stops a
 * repository with a handful of branches from being mostly white space.
 */
export const LANE_HEIGHT = 64;
/**
 * The grid the history itself is drawn on: half a cell each way.
 *
 * History runs left to right — a commit sits one column past the last of its
 * parents, so the oldest owns the leftmost column and a branch grows out of the
 * very commit it was cut from — and down the page a row per line of
 * development. None of it is words: a commit is a dot and a piece of history is
 * a line, so it packs into half the step a name needs, and the shape of a
 * repository is that much more of it at a glance.
 */
export const COMMIT_STEP = { x: COLUMN_WIDTH / 2, y: LANE_HEIGHT / 2 };
export const DOT_SIZE = 14;
/** One step of the row grid, for anything drawn to the scale of the layout. */
export const STEP = { x: COLUMN_WIDTH, y: LANE_HEIGHT };
/**
 * A workspace round the commit it has checked out.
 *
 * The commit stays visible as the small solid centre; this ring is far enough
 * outside it to read as another layer rather than as the dot's border.
 */
export const HEAD_SIZE = 20;
/**
 * How far under a branch's own ring the remote end of the same branch stands.
 *
 * The two ends share a row — one branch, one row — so what tells them apart is
 * this drop rather than a row each. Downwards because it is the one side of a
 * head that is free: the terminal a branch offers stands straight above, the
 * line in from the history arrives level with the ring, and the lines out to
 * what is running leave level the other way. Small enough that the pair reads
 * as one thing, and small enough that the dropped ring stays inside its row's
 * own cell, so a branch having a remote costs the band no height.
 */
export const PAIR_DROP = 20;
/**
 * The origin ring drawn round the commit it points at.
 *
 * Large enough to sit outside both the commit and its workspace. When origin
 * has moved away it keeps this same size around the commit at its own end, so
 * the three radii keep one meaning everywhere on the canvas.
 */
export const PAIR_RING = 28;
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
export const PAIR_RING_TRIM = PAIR_RING / 2 + RING_EDGE_GAP;

/**
 * One commit's cell. The same box for every commit, so it is shared.
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
 * One commit's cell, which is a cell of the history's own grid: half of the
 * above each way.
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
/** Enough for the repository's own name, however short its history is. */
export const MIN_BAND_WIDTH = 240;
/**
 * The repository's name takes the column before the mark its band opens with —
 * the first commit drawn, or the fold standing in for the history behind it —
 * and is set on that mark's own line: another cell in the same grid, so the
 * name reads as the start of the history rather than as a caption over it.
 */
export const NAME_COLUMN = 1;
export const REPO_GAP_Y = 40;
/**
 * How far a folder's repositories are set in from the folder itself.
 *
 * A whole cell, so that the folder's own mark stands clear to the left of
 * everything it holds and the line out to each of them has somewhere to run.
 * The eye runs down one edge: every repository in a folder begins at this
 * column, whether it is folded into a single mark or opened out into a band.
 */
export const FOLDER_INSET = NAME_COLUMN * COLUMN_WIDTH;
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
export const FOLDER_GAP_Y = 16;
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

import type { Node } from "@xyflow/react";

import type { Branch, Commit, Repository, Worktree } from "../../types/git";
import type { Session } from "../session";
import type { AskFlowNode } from "./asking";
import type { ReportFlowNode } from "./reporting";

/**
 * The vocabulary the graph is drawn in: the grid it is laid out on, the ink it
 * is drawn in, and what each kind of node carries.
 *
 * Nothing here reads a repository or decides where anything goes — that is
 * `layout` for one repository and `build` for the canvas they share. This is
 * only what both of them mean by a cell, a lane and a node.
 */

/**
 * History runs left to right: a commit sits one column past the last of its
 * parents, so the oldest commit owns the leftmost column, the newest the
 * rightmost, and a branch grows out of the commit it was cut from. Small on
 * purpose — the whole tree should fit on the canvas.
 */
export const COLUMN_WIDTH = 132;
/**
 * Vertical distance between two parallel lines of development, and the height
 * of one cell.
 *
 * Tighter than the horizontal step: history runs along the x axis and needs the
 * room, while a row only has to be told apart from the one above it. Every row a
 * branch takes costs this much band, so keeping it down is what stops a
 * repository with a handful of branches from being mostly white space.
 */
export const LANE_HEIGHT = 64;
export const DOT_SIZE = 14;
/** One step of the grid, for anything drawn to the scale of the layout. */
export const STEP = { x: COLUMN_WIDTH, y: LANE_HEIGHT };
/** A branch head, drawn a touch larger than a commit — it is the handle. */
export const HEAD_SIZE = 16;
/**
 * How far short of a hollow mark a line has to stop.
 *
 * A head and the offer of a branch are rings with the canvas showing through
 * them, so a line drawn to the middle of one is drawn across the hole. It ends
 * at the rim instead, and the ring of canvas colour every mark carries covers
 * what is left between the two.
 */
export const RING_TRIM = HEAD_SIZE / 2;
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
 * Half a cell: history needs a column wide enough to carry a name along every
 * line in it, and nothing out here carries one — what hangs off a branch is
 * whatever is running in it, marks the size of a chip.
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
 * Where a branch's stack of terminals is measured from, from the top of that
 * branch's row.
 *
 * Half the difference between a lane and a step, so the middle of the stack
 * comes out level with the branch itself rather than with the top edge of its
 * row. The stack is then hung on the branch's own line, half of it above and
 * half below — see `stackReach`.
 */
export const STACK_TOP = (LANE_HEIGHT - CLI_STEP) / 2;
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
 * below, which is why the layout needs the depth of both to space two rows —
 * see `spacing` in the layout.
 */
export function stackReach(marks: number): number {
  return ((marks - 1) * CLI_STEP) / 2;
}
/**
 * How far a row outside a band reaches from its own line, either way.
 *
 * A lane, or its stack where that is deeper. What the group is measured by at
 * its two ends — the row under the folder, and the last row of the column —
 * where there is no neighbour to share the room with.
 */
export function rowReach(marks: number): number {
  return Math.max(LANE_HEIGHT / 2, stackReach(marks) + CLI_STEP / 2);
}
/**
 * How far apart the lines of two neighbouring rows stand, given what each of
 * them is running.
 *
 * The same sum a band spaces its branches by — see `spacing` in the layout —
 * because it is the same shape: a stack is centred on its row's own line, so
 * the room it takes is split between the row above and the row below, and the
 * gap between two rows is a sum over both of their stacks. A lane holds a row
 * and one terminal without any of that showing, which is what `CLI_CLEAR` says
 * a lane has spare, so nothing moves until something is running two at once.
 */
export function rowPitch(above: number, below: number): number {
  return Math.max(LANE_HEIGHT, reachOf(above) + reachOf(below) + CLI_CLEAR);
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

export type CommitNodeData = {
  commit: Commit;
  repository: Repository;
  lane: number;
  branches: Branch[];
  worktrees: Worktree[];
  /**
   * At least one parent is outside the history the repository handed over, so
   * the line really does end here. History that is merely folded away is not
   * this: the fold has its own dash and its own way back.
   */
  boundary: boolean;
  /**
   * At least one parent is known and merely folded away, and the collapse
   * node's own dash does not already run here.
   *
   * This is the fold's dash, on the commits the fold's single line cannot
   * reach: a lane is handed on the moment the commit holding it is drawn, so a
   * chain cut short by the fold is followed along its own row by an unrelated
   * one, and the two marks either side of the join have nothing drawn between
   * them. Without this that gap reads as a line that failed to draw.
   */
  folded: boolean;
};

export type RefKind = "local" | "remote" | "worktree";

/**
 * Where a branch is: the head the line cut at a commit runs out to.
 *
 * A branch that was cut and never committed to still has one, which is the
 * point of drawing it — the head is what says the branch exists, and the curve
 * out to it carries the name.
 *
 * A worktree is where a branch is checked out, one at most, so the branch name
 * already says which worktree it is and the folder name is left off.
 */
export type BranchHeadData = {
  repository: Repository;
  kind: RefKind;
  name: string;
  /** This ref exists on at least one remote, rather than only on this machine. */
  hasRemote: boolean;
  /** The worktree this is checked out in, which a shell can be opened in. */
  cwd: string | null;
  /**
   * The branch is only being proposed: a pull has reached the history it
   * stands on and the hand has not let go of it yet.
   *
   * Folding a stretch of history away folds away what is on it, so a pull the
   * other way brings branches back — and until it is let go they are drawn the
   * way this canvas draws everything that is an offer rather than a fact. See
   * `useHistoryPull`.
   */
  provisional?: boolean;
};

export type RepositoryNodeData = {
  repository: Repository;
  /** Band-relative box of the name's cell, which leads the row the band opens on. */
  label: { x: number; y: number; width: number; height: number };
};

/**
 * A folder that was put on the graph: the row that heads the repositories in
 * it.
 *
 * A folder is not a repository and is drawn as one line rather than as a band
 * of history — its name, its own mark, and the one button a directory answers
 * to. What it holds stands underneath, a repository to a row, each joined back
 * to that mark.
 *
 * The row is also a place: a terminal opened here runs in the folder itself,
 * which is where work that spans the repositories happens, and anything already
 * running in there stands beside this row.
 */
export type FolderNodeData = {
  /** The directory itself, which is what a terminal here opens in. */
  root: string;
  name: string;
  /** Band-relative box of the name's cell, which leads the row. */
  label: { x: number; y: number; width: number; height: number };
  /**
   * Whether every repository in it is opened out.
   *
   * What the name does when it is pressed: a folder with anything still folded
   * opens the lot, and one that is fully open folds the lot away.
   */
  open: boolean;
  /**
   * Band-relative left edge of the folder's own mark.
   *
   * The one thing on the row that is the folder itself: every line out to a
   * repository leaves it, and it is what the hand takes the group by.
   */
  mark: number;
  /** Band-relative left edge of the row's own button. */
  tools: number;
};

/**
 * One repository folded into a single mark, on its own row under its folder.
 *
 * The simplification is the point: a folder of a dozen repositories is a dozen
 * rows of one line each, and pressing one opens that repository's history out
 * in place. Until then the ring is the whole of the repository — everything
 * working in any of its worktrees stands beside that ring, so folding a
 * repository away never loses what is running in it.
 */
export type RepoMarkData = {
  repository: Repository;
};

/** The history that is not being shown, and the way to ask for it. */
export type CollapseNodeData = {
  repository: Repository;
  hidden: number;
};

/**
 * One terminal: the single mark this canvas draws for anything to do with a
 * shell.
 *
 * There used to be three of these — the offer beside a branch, this window's
 * own session, and a terminal the sweep found somebody else running — and they
 * were three shapes in two places. The offer is not a mark at all now: it is
 * the button on the branch's own ring, and pressing it puts one of these on the
 * canvas. So every mark in a stack is a terminal that exists, and the stack is
 * exactly what is running in that branch, oldest first.
 *
 * The whole of what a terminal is is said by its state: whose it is, and what
 * it is running. Which of those it is is read off the two fields below, and
 * there is no third case.
 */
export type CliNodeData = {
  /** The terminal itself, which is what a press on the mark shows and ends. */
  session: Session;
  /** The one the panel is showing, if it is this one. */
  showing: boolean;
  /** Which of the directory's sessions it is, when there is more than one. */
  ordinal: number | null;
};

/**
 * The box every terminal mark is drawn in, wherever it is standing.
 *
 * One box for all of them, which is what lets a stack be read down a single
 * line: a terminal this window opened and one the sweep found somebody else
 * running are the same mark in the same room, and the stack grows by a box
 * rather than by a shape.
 */
export const STACK_STYLE = {
  width: SESSION_WIDTH,
  height: CLI_STEP,
  pointerEvents: "none",
} as const;

/**
 * What the canvas is being built against.
 *
 * Nothing is collected across the build any more: every terminal stands beside
 * the row it is running in, and a row knows where its own marks go — so this is
 * only what did not have to be rebuilt at all.
 */
export type Draw = {
  /** The graph this one replaces, which is what did not have to be rebuilt. */
  before: ReadonlyMap<string, AppNode>;
};

/**
 * How big a file card is, in the units of whatever it is standing in: canvas
 * units while the card is on the canvas, and the pane's own pixels once it has
 * been pinned over the window. Pinning is what carries the box between the two.
 */
export type FilePreviewBox = { width: number; height: number };

/** A bounded file reading shown in a freely placed card on the canvas. */
export type FilePreviewNodeData = {
  requestId: number;
  path: string;
  name: string;
  text: string | null;
  size: number | null;
  truncated: boolean;
  state: "loading" | "ready" | "failed";
  /** The reading is put away and the card is left as tall as its header. */
  collapsed: boolean;
  /**
   * What the card was last left at.
   *
   * The size a card is at belongs to the node itself, because that is what an
   * edge dragged writes to. A card put away has no height of its own for the
   * canvas to measure, so the one it had is kept here to be given back.
   */
  box: FilePreviewBox;
  /**
   * Where the card is pinned over the window, in the canvas pane's own pixels,
   * or null while it is still standing on the canvas.
   *
   * A pinned card has left the canvas: it is drawn over it instead, at the
   * place on screen it was pinned at, and nothing the canvas is dragged or
   * zoomed to reaches it. So where it is cannot be a position on the canvas —
   * that is exactly the coordinate system it has stepped out of — and this is
   * the one it is in instead. The position it left behind is kept on the node,
   * unread until it is put back.
   */
  pinnedAt: { x: number; y: number } | null;
};

export type CommitFlowNode = Node<CommitNodeData, "commit">;
export type BranchHeadFlowNode = Node<BranchHeadData, "head">;
export type CollapseFlowNode = Node<CollapseNodeData, "collapse">;
export type RepositoryFlowNode = Node<RepositoryNodeData, "repository">;
export type FolderFlowNode = Node<FolderNodeData, "folder">;
export type RepoMarkFlowNode = Node<RepoMarkData, "repo-mark">;
export type CliFlowNode = Node<CliNodeData, "cli">;
export type FilePreviewFlowNode = Node<FilePreviewNodeData, "file-preview">;
export type AppNode =
  | CommitFlowNode
  | BranchHeadFlowNode
  | CollapseFlowNode
  | RepositoryFlowNode
  | FolderFlowNode
  | RepoMarkFlowNode
  | CliFlowNode
  | AskFlowNode
  | ReportFlowNode
  | FilePreviewFlowNode;

/**
 * One line of the graph: the two marks it joins, and how it gets from one to
 * the other.
 *
 * History is lines, and there are as many of them as there are commits. Given
 * to the engine one element apiece — which is what an edge per line comes to —
 * they were half of everything on the canvas and the greater part of what a
 * frame cost. So a line is this instead: the ends it runs between, which the
 * canvas turns into a piece of path data and joins to every other line drawn
 * the same way.
 *
 * The ends are named rather than placed, because where a mark is and where its
 * line ends have to be the same answer. A repository laid out again walks its
 * commits to their new places over a few frames, and a line drawn from what the
 * layout says rather than from where the mark actually is would leave the dots
 * walking and the lines already arrived.
 *
 * What the pointer can do with a line is not drawn at all until it is on one;
 * see `FoldTarget` and `GraphLines`.
 */
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
 * Every node the graph draws but a session takes a whole cell, and its mark is
 * in the middle of it — so a line into one ends half a cell along and half a
 * cell down from wherever that node is standing.
 */
export function onCell(node: string): LineEnd {
  return { node, dx: COLUMN_WIDTH / 2, dy: LANE_HEIGHT / 2 };
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
export type FoldTarget = {
  /** The line as a run of points, which the pointer is measured against. */
  run: number[];
  /** Where the mark goes when the pointer is on it. */
  at: { x: number; y: number };
  /** How much history is left showing once it is folded. */
  keep: number;
  /** How much would go with it; there is no offer when it is none. */
  hides: number;
};

/**
 * Every line one repository draws, batched by how it is drawn.
 *
 * The batching is the whole point: a thousand lines of one colour are one path
 * with a thousand pieces in it, and the engine is asked for one element instead
 * of a thousand. Named lines are kept out of it — a name is set along its own
 * line and needs a path it can be pointed at.
 */
export type BandLines = {
  strokes: { key: string; stroke: StrokeStyle; parts: GraphLine[] }[];
  named: GraphLine[];
  /** What can be folded, by the cell of the grid the pointer would be in. */
  folds: Map<string, FoldTarget[]>;
  /**
   * Where each commit's dot is, by the cell it sits in.
   *
   * What the offer of a branch is drawn from: the pointer is on a commit when
   * it is on the dot, and the offer is a curve out of that dot. One entry per
   * commit, which is what makes finding it a division rather than a search.
   */
  dots: Map<string, { at: { x: number; y: number }; node: CommitFlowNode }>;
};

export type GraphResult = {
  nodes: AppNode[];
  /** The bands, in the order they are drawn, each with its lines. */
  bands: Band[];
  /**
   * Every line that is not one repository's own: what a folder holds, and what
   * is running in the rows a folder draws.
   *
   * Drawn on the canvas rather than inside a band, because both ends of these
   * are the canvas's — a folder's mark and the band of a repository opened out
   * of it are two things standing on it, and neither is inside the other.
   *
   * Batched by colour, the way a band batches its own lines: a canvas with a
   * score of these on it is a handful of paths.
   */
  reach: { key: string; stroke: StrokeStyle; parts: GraphLine[] }[];
  /**
   * The folder groups, by the directory each was opened on.
   *
   * What the canvas is arranged in and what it is moved in: a group is a folder
   * and everything under it, so dragging the folder's own mark takes the whole
   * of it. `at` is where the group would stand if nobody had moved it, which is
   * what a drag is measured against; `members` is everything standing in it
   * that is not inside something else already listed — a band carries its own
   * commits, so only the band itself is here.
   */
  groups: ReadonlyMap<string, Group>;
  /**
   * How far what is drawn reaches, which is the box the lines are given.
   *
   * An SVG root clips to its own box whatever it is told about overflow, and
   * the bands under the repositories — the places the canvas does not draw —
   * are exactly where the longest of these lines end.
   */
  extent: { width: number; height: number };
};

/**
 * One folder and everything laid out under it, as the canvas holds it.
 *
 * A folder is the unit somebody put on the graph, so it is the unit the canvas
 * is arranged in and the unit it is rearranged in: the row, the repositories in
 * it — folded into a mark or opened into a band — and whatever is running in
 * any of them all move together, because they are one thing.
 */
export type Group = {
  /** The folder's own node, which is the one thing here that is dragged. */
  node: string;
  /** Where the group is laid out, before anything was moved by hand. */
  at: { x: number; y: number };
  /**
   * Everything else that travels with it, by node id.
   *
   * Only what stands on the canvas in its own right: a band's commits are
   * placed inside the band and follow it without being named here.
   */
  members: readonly string[];
};

/**
 * A repository's band: where it sits on the canvas, and what is drawn in it.
 *
 * The lines are held in the band's own coordinates and the band is moved by a
 * transform, so laying the canvas out again moves a repository without a single
 * line being worked out afresh.
 */
export type Band = {
  id: string;
  x: number;
  y: number;
  /** The box the band was given, which is what the canvas is measured from. */
  width: number;
  height: number;
  lines: BandLines;
  /**
   * What joins each branch to the terminals working in it.
   *
   * Apart from `lines` because these are the one thing in a band that is not
   * the repository: a terminal opening changes them and changes nothing else,
   * and the layout they hang off is handed back untouched.
   */
  runs: BandLines["strokes"];
  /**
   * The whole band is what a pull is reaching for rather than what the
   * repository is showing.
   *
   * Every line and mark in it is drawn dashed while that is so, which is one
   * class on the band's own group — see `GraphLines` — rather than a different
   * stroke on each of a thousand lines. Let go, and the band is rebuilt at the
   * depth it reached with nothing provisional about it.
   */
  provisional?: boolean;
};

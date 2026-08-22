import type { Node } from "@xyflow/react";

import type { Branch, Commit, Repository, Worktree } from "../../types/git";
import type { Agent } from "../../types/running";
import type { Session } from "../session";
import type { AskFlowNode } from "./asking";

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
 * The repository's name takes the column before its first commit, on the line
 * the repository is on: another cell in the same grid, so the name reads as the
 * start of the history rather than as a caption over it.
 */
export const NAME_COLUMN = 1;
export const REPO_GAP_X = 56;
export const REPO_GAP_Y = 40;
/**
 * How far a folder's repositories are set in from the folder itself.
 *
 * A whole cell, so a repository's own name column begins where the folder's
 * marks do: the eye runs down the same edge whether a repository is folded into
 * one mark on the folder's row or opened out into a band under it.
 */
export const FOLDER_INSET = NAME_COLUMN * COLUMN_WIDTH;
/**
 * One repository folded into a single mark, in the row of the folder it is in.
 *
 * A cell of the grid apiece, the way a commit takes one: the mark is a ring and
 * the rest of the cell is the repository's name, which is the whole of what a
 * folded repository says. Anything narrower would be a row of rings nobody
 * could tell apart, and anything wider would put the fourth repository off the
 * side of the canvas.
 */
export const REPO_MARK_WIDTH = COLUMN_WIDTH;
/**
 * How far the ring on a folded repository sits from the right edge of its cell.
 *
 * On the right, with the name set against it, so that the mark reads the way a
 * band does — the name, then the thing itself — and so that the lines from the
 * column, which all arrive from the right, end on the ring rather than crossing
 * the name to get to it.
 */
export const REPO_MARK_RING = 14;
/** How far a folder's group is set below the row that heads it. */
export const FOLDER_GAP_Y = 16;
/** Width-to-height ratio the packed canvas aims for. */
export const TARGET_ASPECT = 1.9;
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
 * The stylesheet holds this value too, because the ghost of a branch and the
 * fold on a line are drawn by CSS rather than from a layout.
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
};

export type RepositoryNodeData = {
  repository: Repository;
  /** Band-relative box of the name's cell, which leads the trunk row. */
  label: { x: number; y: number; width: number; height: number };
};

/**
 * A folder that was put on the graph: the row above the repositories in it.
 *
 * A folder is not a repository and is drawn as one line rather than as a band
 * of history — its name, then the repositories it holds that are folded into a
 * mark each, then the one button a directory answers to. What is opened out
 * stands underneath as a band of its own, and leaves the row.
 *
 * The row is also a place: a terminal opened here runs in the folder itself,
 * which is where work that spans the repositories happens, and the lines from
 * anything already running in there land on this row.
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
  /** Band-relative left edge of the row's own button. */
  tools: number;
};

/**
 * One repository folded into a single mark, on its folder's row.
 *
 * The simplification is the point: a folder of a dozen repositories is a dozen
 * marks and one line of canvas, and pressing one opens that repository's
 * history out underneath. Until then the mark is where everything about that
 * repository arrives — the lines from whatever is working in any of its
 * worktrees end here rather than nowhere.
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
  /** This window's own, which is the one kind that can be shown and ended. */
  session: Session | null;
  /**
   * The process behind it, when there is one the sweep knows about.
   *
   * Set for a terminal somebody else opened and for one of this window's own
   * that has been paired with what the sweep found; null for a session whose
   * process has not been seen yet.
   */
  cli: Agent | null;
  /** The one the panel is showing, if it is this one. */
  showing: boolean;
  /** Which of the directory's same-kind sessions it is, when there is more than one. */
  ordinal: number | null;
  /** What is running in it, as a colour; a plain shell has none of its own. */
  colour: string;
  /**
   * How many agents it is running that have no process of their own.
   *
   * The lines say where those agents are working, and two of them in the same
   * directory are one line; this is what says there were two. A count rather
   * than marks: a subagent is a thread of this very terminal, and the canvas
   * growing a mark every time one starts would say the machine was filling up
   * when what happened is that one terminal got busy.
   */
  carrying: number;
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
 * What the canvas is being built against, and what building it leaves behind.
 *
 * The column of terminals is drawn last and joined to everything else, so the
 * places a line can land in have to be collected as the bands go down and read
 * once at the end. That is what `rows` is; `before` is only what did not have
 * to be rebuilt at all.
 */
export type Draw = {
  /** The graph this one replaces, which is what did not have to be rebuilt. */
  before: ReadonlyMap<string, AppNode>;
  /** Where a line into a directory lands, by that directory. */
  rows: Map<string, LineEnd>;
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

/** What a terminal running nothing in particular is drawn in. */
export const SHELL_COLOR = "var(--mui-palette-text-disabled)";

/**
 * How an agent is drawn: a thin dashed line from the terminal running it to the
 * branch it is working in.
 *
 * Dashed because it is not history — nothing here was committed — and in the
 * colour of whatever is running, which is the one place on this canvas where a
 * colour names a thing rather than a line of development. It has to: the marks
 * at either end are a terminal and a branch, and neither of them is the agent.
 * The line is.
 */
export function reachStroke(colour: string): StrokeStyle {
  return { colour, width: 1.2, opacity: 0.5, dash: "2 4" };
}

/**
 * A terminal that really is running, joined to the branch it is driving.
 *
 * Solid, in the colour of whatever is in it — and thicker than the dashes an
 * agent of the same terminal is drawn in, so that the place somebody is sitting
 * in front of is told from the places they have work going on at a glance.
 *
 * Every line into this column is one of these now: what a branch could be
 * running and is not is said by the button on its ring, and a dashed line out
 * to a mark holding a place open was the canvas drawing something that had not
 * happened.
 */
export function runStroke(colour: string): StrokeStyle {
  return { colour, width: 1.4, opacity: 0.7 };
}

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
   * Every agent that is running, as a line from the terminal running it to the
   * branch it is working in.
   *
   * Drawn on the canvas rather than inside a band, because these are the one
   * kind of line that crosses from one repository to another — which is the
   * whole point of drawing them. What is running is not a fact any single
   * branch can hold: one terminal can have work going on in three of them.
   *
   * Batched by colour, the way a band batches its own lines: a canvas with a
   * score of agents on it is a handful of paths.
   */
  reach: { key: string; stroke: StrokeStyle; parts: GraphLine[] }[];
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
 * A repository's band: where it sits on the canvas, and what is drawn in it.
 *
 * The lines are held in the band's own coordinates and the band is moved by a
 * transform, so packing the canvas again moves a repository without a single
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
};

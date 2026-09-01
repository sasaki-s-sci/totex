import type { Repository } from "../../types/git";
import { drawCommits } from "./band/commits";
import type { Frame } from "./band/frame";
import { drawHeads } from "./band/heads";
import { placeBranches } from "./branches";
import type { Point } from "./geometry";
import { depthOf, placeHistory } from "./history";
import { Lines } from "./lines";
import {
  type BandLines,
  type BranchHeadFlowNode,
  branchPitch,
  CHIP_STEP,
  COLUMN_WIDTH,
  COMMIT_STEP,
  type CollapseFlowNode,
  type CommitFlowNode,
  gridRows,
  MIN_BAND_WIDTH,
  NAME_HEIGHT,
  type RepositoryNodeData,
  rowReach,
  SESSION_WIDTH,
} from "./model";

/**
 * One repository, laid out: where every commit, branch head and offer goes
 * inside the band that holds them.
 *
 * A band is read left to right in four parts — the name, the history on a grid
 * of its own, every branch in a single column of branch lanes, and what is
 * running in each of them stacked off that row. An edge forks from its commit
 * lane into the branch lane exactly as history forks between commit lanes.
 *
 * What is actually in each stack is `build`'s to fill — terminals come and go
 * while the layout does not — but how deep each stack is belongs here, because
 * a stack pushes the branches under it down. The band's own position on the
 * canvas is `build`'s too, so everything below is relative to it.
 */

/**
 * One repository, drawn. The commits are positioned inside the band rather than
 * on the canvas, so the column can move the band without touching any of them.
 */
export type PreparedRepository = {
  repository: Repository;
  /** The band's own node data and box, which is what the column moves. Its
   *  label is where the line down from the folder lands. */
  data: RepositoryNodeData;
  style: { width: number; height: number };
  nodes: (CommitFlowNode | BranchHeadFlowNode | CollapseFlowNode)[];
  /** Every line the band draws, already batched by how it is drawn. */
  lines: BandLines;
  /** Where each branch's terminals stand, in the order the bands were laid out. */
  runs: BranchRun[];
};

/**
 * One branch's stack of terminals: where it starts, and how much room it has.
 *
 * The layout says where the stack stands and `build` puts the marks in it,
 * because which terminals are running is not history. The marks are packed a
 * `CLI_STEP` at a time and centred on `x, y`; a branch running nothing has no
 * stack at all, only the button on its own ring.
 */
export type BranchRun = {
  /** The branch's own node, which is what a terminal working here is joined to. */
  head: string;
  /** The directory the stack is of, or null while the branch is only a name. */
  cwd: string | null;
  /** Band-relative middle of that node, where a line into this branch lands. */
  at: Point;
  /** Band-relative corner of the box a stack of one would stand in: its middle. */
  x: number;
  y: number;
  /** How far beyond the head's centre its outgoing edge begins. */
  lead: number;
};

/** How many terminals are running in each directory. All of them, because a
 *  stack is centred on its branch's line: spacing two rows is a sum over both
 *  of their stacks. */
export type Depth = ReadonlyMap<string, number>;

/** Laying a repository out is the expensive half of drawing the graph, and a
 *  change touches one at a time. Keyed by the repository object, which the delta
 *  preserves for everything it did not change. */
const layouts = new WeakMap<
  Repository,
  { shown: number; deep: string; prepared: PreparedRepository }
>();

export function prepare(
  repository: Repository,
  want: number | undefined,
  deep: Depth,
): PreparedRepository {
  const shown = depthOf(repository, want);
  // What of that map this repository is actually affected by, as one string, so
  // that terminals opening and closing somewhere else on the canvas are not a
  // reason to lay this one out again.
  const key = repository.worktrees.map((worktree) => deep.get(worktree.path) ?? 0).join(",");

  const cached = layouts.get(repository);
  if (cached && cached.shown === shown && cached.deep === key) return cached.prepared;

  const prepared = layout(repository, shown, deep);
  layouts.set(repository, { shown, deep: key, prepared });
  return prepared;
}

/** How far past the end of the history the branches stand.
 *
 * `columnX(history.width)` is half a commit step past the centre of the last
 * history column. Adding the other half puts a branch/worktree ring exactly one
 * commit step after that column, so the transition out of history keeps the
 * same rhythm as the commits themselves. */
const BRANCH_GAP = COMMIT_STEP.x / 2;

/** Every node and line one repository contributes, relative to its band. */
function layout(repository: Repository, shown: number, deep: Depth): PreparedRepository {
  const history = placeHistory(repository, shown);
  const { refs, rows } = placeBranches(repository, history.placed);

  // How deep each row of the branch column is: what is running there, and
  // nothing else. The offer of a terminal is a button on the branch's own ring
  // now, so a branch with nothing in it asks for no room out here.
  const stacks = new Array<number>(rows).fill(0);
  for (const ref of refs) {
    const cwd = ref.data.cwd;
    if (cwd !== null) stacks[ref.row] = Math.max(stacks[ref.row], deep.get(cwd) ?? 0);
  }

  // Both halves hang from the trunk's line, half a lane down the band. Half a
  // lane, because that is the room the repository's name asks for above it and
  // what a workspace stack on that line reaches up by — whichever is the more.
  const top = gridRows(Math.max(NAME_HEIGHT, rows > 0 ? rowReach(stacks[0]) : 0));

  /** The line each row of the history is drawn along: evenly spaced. */
  const historyLine = (row: number) => top + row * COMMIT_STEP.y;
  /**
   * And each row of the branch column: the same grid row as the history beside
   * it, until what is running in one of them asks for more room than the lane
   * between two branches holds — and then the rest of the column drops a whole
   * grid row rather than sliding by whatever the stack overflowed by.
   */
  const branchLine: number[] = [];
  for (let row = 0; row < rows; row++) {
    branchLine.push(
      row === 0 ? historyLine(0) : branchLine[row - 1] + branchPitch(stacks[row - 1], stacks[row]),
    );
  }

  /** The left edge of a column of the history, which the band opens on: the
   *  name is set over the first of them rather than in a cell before it, so
   *  nothing stands between the folder's line and the history it arrives at. */
  const columnX = (column: number) => column * COMMIT_STEP.x;
  // Where every branch's own mark stands, which is what everything hanging off
  // one is measured from: the ring itself rather than the edge of its cell, so
  // that the terminals beside a branch read as that branch's own and not as a
  // row of their own.
  const ring = columnX(history.width) + BRANCH_GAP;
  const heads = ring - COLUMN_WIDTH / 2;
  // The terminals stack out past the ring, in a column of their own that no
  // line of the history ever crosses.
  const working = ring + CHIP_STEP;

  const nodes: (CommitFlowNode | BranchHeadFlowNode | CollapseFlowNode)[] = [];
  const drawn = new Lines();
  const runs: BranchRun[] = [];

  // Where every commit's dot ends up, which is where the lines into and out of
  // it are drawn from. A line runs mark to mark, and a mark is the middle of
  // its cell — so this is the cell's middle and not its corner.
  const dots = history.placed.map((entry, position) => ({
    x: columnX(history.columns[position]) + COMMIT_STEP.x / 2,
    y: historyLine(entry.row),
  }));

  const frame: Frame = {
    repository,
    history,
    dots,
    columnX,
    historyLine,
    branchLine,
    heads,
    ring,
    working,
    drawn,
    nodes,
    runs,
  };
  drawCommits(frame);
  drawHeads(frame, refs);

  // the history and the branch column reaches furthest down.
  const bottom = gridRows(
    Math.max(
      historyLine(Math.max(history.depth - 1, 0)) + COMMIT_STEP.y / 2,
      rows > 0 ? branchLine[rows - 1] + rowReach(stacks[rows - 1]) : 0,
    ),
  );

  // Where the terminals stand is part of the band whether or not anything is
  // standing there: the room belongs to the repository, and a band that widened
  // the moment a terminal opened in it would move every repository beside it.
  const width = Math.max(MIN_BAND_WIDTH, working + SESSION_WIDTH / 2);

  return {
    repository,
    data: {
      repository,
      label: {
        x: 0,
        // The band's own first line, which is where the fold stands and where
        // the topmost branch is: the name is set in the air over it, at the
        // left edge of the band, so it heads the whole of what is under it
        // rather than labelling the one row it happens to be level with.
        y: top - NAME_HEIGHT,
        // As far as the column the terminals stand in, which is the one thing
        // that can reach up into this line: a stack centred on the topmost
        // branch opens out above that branch as well as below it.
        width: working - SESSION_WIDTH / 2,
        height: NAME_HEIGHT,
      },
    },
    style: {
      width,
      height: bottom,
    },
    nodes,
    lines: drawn.done(),
    runs,
  };
}

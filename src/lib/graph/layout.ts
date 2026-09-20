import type { Repository } from "../../types/git";
import { drawCommits } from "./band/commits";
import type { Frame } from "./band/frame";
import { drawHeads } from "./band/heads";
import { drawJunctions } from "./band/junctions";
import { placeBranches } from "./branches";
import type { Point } from "./geometry";
import { depthOf, placeHistory } from "./history";
import { bundleBranches, dealColumn, junctionId } from "./junctions";
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
  type JunctionFlowNode,
  MIN_BAND_WIDTH,
  NAME_HEIGHT,
  type RepositoryNodeData,
  rowReach,
  SESSION_WIDTH,
} from "./model";

// Everything here is relative to the band; `build` places the band and fills
// the terminal stacks whose depth is reserved here.

export type PreparedRepository = {
  repository: Repository;
  data: RepositoryNodeData;
  style: { width: number; height: number };
  /** The trunk line, where the folder connects to this band. */
  trunk: number;
  nodes: (CommitFlowNode | BranchHeadFlowNode | CollapseFlowNode | JunctionFlowNode)[];
  lines: BandLines;
  runs: BranchRun[];
};

/** Where one branch's stack of terminals stands; `build` fills it. */
export type BranchRun = {
  head: string;
  branch: string;
  cwd: string | null;
  /** Band-relative middle of the head node, where a line into this branch lands. */
  at: Point;
  /** Band-relative corner of the box a stack of one would stand in: its middle. */
  x: number;
  y: number;
  /** How far beyond the head's centre its outgoing edge begins. */
  lead: number;
};

/** Terminals running per directory. */
export type Depth = ReadonlyMap<string, number>;

// Keyed by the repository object, which the workspace delta preserves when unchanged.
const layouts = new WeakMap<
  Repository,
  { shown: number; deep: string; shut: string; prepared: PreparedRepository }
>();

const NONE_SHUT: ReadonlySet<string> = new Set();

export function prepare(
  repository: Repository,
  want: number | undefined,
  deep: Depth,
  closed: ReadonlySet<string> = NONE_SHUT,
): PreparedRepository {
  const shown = depthOf(repository, want);
  // Only this repository's own worktrees and knots are part of the cache key.
  const key = repository.worktrees.map((worktree) => deep.get(worktree.path) ?? 0).join(",");
  const shut = [...closed]
    .filter((id) => id.startsWith(junctionId(repository.id, "")))
    .sort()
    .join(",");

  const cached = layouts.get(repository);
  if (cached && cached.shown === shown && cached.deep === key && cached.shut === shut) {
    return cached.prepared;
  }

  const prepared = layout(repository, shown, deep, closed);
  layouts.set(repository, { shown, deep: key, shut, prepared });
  return prepared;
}

// Puts the ring exactly one commit step past the last history column.
const BRANCH_GAP = COMMIT_STEP.x / 2;

function layout(
  repository: Repository,
  shown: number,
  deep: Depth,
  closed: ReadonlySet<string>,
): PreparedRepository {
  const history = placeHistory(repository, shown);
  const running = (cwd: string | null) => cwd !== null && (deep.get(cwd) ?? 0) > 0;
  const { refs: every } = placeBranches(repository, history.placed, {
    folded: history.hidden > 0,
    running,
  });
  const bundle = bundleBranches(repository.id, every, {
    closed,
    running: (ref) => running(ref.data.cwd),
  });
  const { refs, rows, seats } = dealColumn(every, bundle);

  const stacks = new Array<number>(rows).fill(0);
  for (const ref of refs) {
    const cwd = ref.data.cwd;
    if (cwd !== null) stacks[ref.row] = Math.max(stacks[ref.row], deep.get(cwd) ?? 0);
  }

  // History lanes open alternately above and below the trunk.
  const laneOffset = (row: number) => (row % 2 === 0 ? row / 2 : -(row + 1) / 2) * COMMIT_STEP.y;
  const historyTop = -Math.floor(history.depth / 2) * COMMIT_STEP.y;
  const historyBottom = Math.floor(Math.max(history.depth - 1, 0) / 2) * COMMIT_STEP.y;

  // The branch column is centred on the trunk to the nearest grid row.
  const branchLine: number[] = [];
  for (let row = 0; row < rows; row++) {
    branchLine.push(
      row === 0 ? 0 : branchLine[row - 1] + branchPitch(stacks[row - 1], stacks[row]),
    );
  }
  const branchTop = rows > 0 ? -rowReach(stacks[0]) : 0;
  const branchBottom = rows > 0 ? branchLine[rows - 1] + rowReach(stacks[rows - 1]) : 0;
  const centre = Math.round((branchTop + branchBottom) / (2 * COMMIT_STEP.y)) * COMMIT_STEP.y;
  const top = gridRows(Math.max(NAME_HEIGHT - historyTop, centre - branchTop));
  const historyLine = (row: number) => top + laneOffset(row);
  for (let row = 0; row < rows; row++) branchLine[row] += top - centre;

  const columnX = (column: number) => column * COMMIT_STEP.x;
  // Terminals are measured from the ring itself, not its cell edge.
  const ring = columnX(history.width + bundle.width) + BRANCH_GAP;
  const heads = ring - COLUMN_WIDTH / 2;
  const working = ring + CHIP_STEP;

  const nodes: (CommitFlowNode | BranchHeadFlowNode | CollapseFlowNode | JunctionFlowNode)[] = [];
  const drawn = new Lines();
  const runs: BranchRun[] = [];

  // Cell middles, since lines run mark to mark.
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
    bundle,
    seats,
    junctionAt: new Map(),
    heads,
    ring,
    working,
    drawn,
    nodes,
    runs,
  };
  drawCommits(frame);
  // Junctions before heads: a gathered branch's line is drawn to its knot.
  drawJunctions(frame, refs, every);
  drawHeads(frame, refs);

  const bottom = gridRows(
    Math.max(
      top + historyBottom + COMMIT_STEP.y / 2,
      rows > 0 ? branchLine[rows - 1] + rowReach(stacks[rows - 1]) : 0,
    ),
  );

  // The terminal column is reserved whether or not anything stands in it, so a
  // band never widens when a terminal opens.
  const width = Math.max(MIN_BAND_WIDTH, working + SESSION_WIDTH / 2);

  return {
    repository,
    data: {
      repository,
      label: {
        x: 0,
        y: top + historyTop - NAME_HEIGHT,
        width: working - SESSION_WIDTH / 2,
        height: NAME_HEIGHT,
        column: COMMIT_STEP.x,
      },
    },
    trunk: top,
    style: {
      width,
      height: bottom,
    },
    nodes,
    lines: drawn.done(),
    runs,
  };
}

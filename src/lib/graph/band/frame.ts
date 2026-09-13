import type { Repository } from "../../../types/git";
import type { Point } from "../geometry";
import { commitNodeId, type placeHistory } from "../history";
import type { Bundle } from "../junctions";
import type { BranchRun } from "../layout";
import type { Lines } from "../lines";
import {
  type BranchHeadFlowNode,
  COMMIT_STEP,
  COMMIT_TRIM,
  type CollapseFlowNode,
  type CommitFlowNode,
  FOLD_TRIM,
  type JunctionFlowNode,
  type LineEnd,
  onCommit,
} from "../model";

export type Frame = {
  repository: Repository;
  history: ReturnType<typeof placeHistory>;

  /** The middle of each commit's cell. */
  dots: Point[];

  columnX: (column: number) => number;

  historyLine: (row: number) => number;

  /** The history's lattice, opened out where a stack of terminals needs room. */
  branchLine: readonly number[];

  bundle: Bundle;

  /** The row a shut knot with nothing under it stands in. */
  seats: ReadonlyMap<string, number>;

  junctionAt: Map<string, Point>;

  heads: number;
  ring: number;

  /** The column a branch's terminals stand in. */
  working: number;
  drawn: Lines;
  nodes: (CommitFlowNode | BranchHeadFlowNode | CollapseFlowNode | JunctionFlowNode)[];
  runs: BranchRun[];
};

export function collapseId(repository: Repository): string {
  return `${repository.id}collapse`;
}

export type Source = {
  end: LineEnd;
  at: Point;

  lead: number;

  /** Leaves the fold, drawn with its dash: otherwise a top-row branch reads as history carrying on. */
  folded: boolean;
};

export function sourceOf(frame: Frame, from: number | null): Source {
  // Branches on folded history hang off the fold rather than being dropped.
  if (from === null) {
    return {
      end: onCommit(collapseId(frame.repository)),
      at: { x: frame.columnX(0) + COMMIT_STEP.x / 2, y: frame.historyLine(0) },
      lead: FOLD_TRIM,
      folded: true,
    };
  }
  return {
    end: onCommit(commitNodeId(frame.repository, frame.history.placed[from].commit.id)),
    at: frame.dots[from],
    lead: COMMIT_TRIM,
    folded: false,
  };
}

export const FOLD_DASH = "4 5";

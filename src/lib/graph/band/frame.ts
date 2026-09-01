/**
 * Where everything in one band goes, worked out before any of it is drawn.
 *
 * The two halves that draw into a band — the history and the branch column —
 * share the same geometry and the same three accumulators, so it is settled
 * once and handed to both.
 */

import type { Repository } from "../../../types/git";
import type { Point } from "../geometry";
import type { placeHistory } from "../history";
import type { BranchRun } from "../layout";
import type { Lines } from "../lines";
import type { BranchHeadFlowNode, CollapseFlowNode, CommitFlowNode } from "../model";

export type Frame = {
  repository: Repository;
  history: ReturnType<typeof placeHistory>;
  /** The middle of each commit's own cell, which every line runs to. */
  dots: Point[];
  /** The left edge of a column of the history, the name's own cell cleared. */
  columnX: (column: number) => number;
  /** The line each row of the history is drawn along. */
  historyLine: (row: number) => number;
  /** The branch column's grid rows: the history's own lattice, opened out a
   *  row at a time wherever a stack of terminals asks for the room. */
  branchLine: readonly number[];
  /** The left edge of a branch's cell, and the middle of its ring. */
  heads: number;
  ring: number;
  /** The column a branch's terminals stand in. */
  working: number;
  drawn: Lines;
  nodes: (CommitFlowNode | BranchHeadFlowNode | CollapseFlowNode)[];
  runs: BranchRun[];
};

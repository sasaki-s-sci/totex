/**
 * Where everything in one band goes, worked out before any of it is drawn.
 *
 * The two halves that draw into a band — the history and the branch column —
 * share the same geometry and the same three accumulators, so it is settled
 * once and handed to both.
 */

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
  /** The middle of each commit's own cell, which every line runs to. */
  dots: Point[];
  /** The left edge of a column of the history, the name's own cell cleared. */
  columnX: (column: number) => number;
  /** The line each row of the history is drawn along. */
  historyLine: (row: number) => number;
  /** The branch column's grid rows: the history's own lattice, opened out a
   *  row at a time wherever a stack of terminals asks for the room. */
  branchLine: readonly number[];
  /** The names gathered by the start they share, and what hangs off each. */
  bundle: Bundle;
  /** Where each of those knots stands, filled in before anything is drawn. */
  junctionAt: Map<string, Point>;
  /** The left edge of a branch's cell, and the middle of its ring. */
  heads: number;
  ring: number;
  /** The column a branch's terminals stand in. */
  working: number;
  drawn: Lines;
  nodes: (CommitFlowNode | BranchHeadFlowNode | CollapseFlowNode | JunctionFlowNode)[];
  runs: BranchRun[];
};

/** The mark that stands for the history a fold hides, where there is one. */
export function collapseId(repository: Repository): string {
  return `${repository.id}collapse`;
}

/** Where a line into the branch column starts. */
export type Source = {
  end: LineEnd;
  at: Point;
  /** How far out from that mark the line begins. */
  lead: number;
  /**
   * The line leaves the fold rather than a commit, and is drawn as the fold's
   * own dash.
   *
   * It carries the same meaning the dash out of the fold into the history
   * carries — the run it stands for is not on screen — and it is what keeps a
   * branch behind the fold from being read as the tip of the line it is drawn
   * along. A branch on the topmost row is otherwise a horizontal run straight
   * through the history's own row, which reads as that history carrying on.
   */
  folded: boolean;
};

/**
 * Where a line into the branch column starts, and how far off that mark.
 *
 * A commit that is drawn, or — for a name standing on history that is folded
 * away — the fold itself, which is the mark the rest of the history is behind.
 * Every branch has one of these: the fold is what a repository showing three of
 * its commits hangs the other forty branches off, rather than dropping them.
 */
export function sourceOf(frame: Frame, from: number | null): Source {
  if (from === null) {
    // The fold stands at the head of the band's first line, in the column the
    // history would carry on into: see `drawCommits`.
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

/** The dash a line out of the fold is drawn with, which is the fold's own. */
export const FOLD_DASH = "4 5";

import { type LineShape, shortOf } from "../geometry";
import { commitNodeId } from "../history";
import {
  COMMIT_CELL,
  COMMIT_STEP,
  COMMIT_TRIM,
  type CommitFlowNode,
  FOLD_TRIM,
  LINE_COLOR,
  onCommit,
} from "../model";
import { collapseId, type Frame } from "./frame";

const HISTORY_STROKE = { colour: LINE_COLOR, width: 1.2, opacity: 0.82 };

export function drawCommits(frame: Frame) {
  const { repository, history, dots, columnX, historyLine, drawn, nodes } = frame;

  for (const [position, entry] of history.placed.entries()) {
    const node: CommitFlowNode = {
      id: commitNodeId(repository, entry.commit.id),
      type: "commit",
      parentId: repository.id,
      extent: "parent",
      position: {
        x: columnX(history.columns[position]),
        y: historyLine(entry.row) - COMMIT_STEP.y / 2,
      },
      data: {
        commit: entry.commit,
        repository,
        branches: entry.branches,
        worktrees: entry.worktrees,
        boundary: entry.boundary,
        folded: entry.folded,
      },
      style: COMMIT_CELL,
    };
    drawn.mark(dots[position], node);
    nodes.push(node);

    for (const parent of entry.commit.parents) {
      const parentPosition = history.index.get(parent);
      if (parentPosition === undefined) continue;

      // Straight within a row: what the curve degenerates to anyway, at a fraction of the work.
      const shape: LineShape =
        entry.row === history.placed[parentPosition].row ? "straight" : "curve";
      const start = shortOf(dots[parentPosition], dots[position], COMMIT_TRIM, shape);
      const end = shortOf(dots[position], dots[parentPosition], COMMIT_TRIM, shape);

      drawn.add(
        {
          id: `${repository.id}${entry.commit.id}->${parent}`,
          from: onCommit(commitNodeId(repository, entry.commit.id)),
          to: onCommit(commitNodeId(repository, parent)),
          shape,
          trim: COMMIT_TRIM,
          lead: COMMIT_TRIM,
          stroke: HISTORY_STROKE,
        },

        {
          // Folding here keeps this commit forward and hides everything behind it.
          keep: position + 1,
          hides: history.placed.length - (position + 1),
          from: start,
          to: end,
          shape,
        },
      );
    }
  }

  if (history.hidden > 0) {
    const oldest = history.placed[history.placed.length - 1];

    nodes.push({
      id: collapseId(repository),
      type: "collapse",
      parentId: repository.id,
      extent: "parent",

      position: { x: columnX(0), y: historyLine(0) - COMMIT_STEP.y / 2 },
      // No z of its own: lifting it would put it over the neighbours' lines.
      data: { repository, hidden: history.hidden },
      style: COMMIT_CELL,
      draggable: false,
      selectable: false,
    });

    drawn.add({
      id: `${repository.id}collapse-edge`,
      from: onCommit(collapseId(repository)),
      to: onCommit(commitNodeId(repository, oldest.commit.id)),

      shape: "curve",
      trim: COMMIT_TRIM,

      // Past the pill's edge, so the dash does not show through its translucent fill.
      lead: FOLD_TRIM,
      stroke: { colour: LINE_COLOR, width: 1.2, opacity: 0.5, dash: "4 5" },
    });
  }
}

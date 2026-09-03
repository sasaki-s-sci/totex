/**
 * The history inside a band: one dot per commit, a line to each of its parents,
 * and the mark that stands where a fold hides the rest.
 */

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

/** How history itself is drawn. */
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

      // A line that stays in its row is drawn straight — which is what the same
      // curve degenerates to anyway, at a fraction of the work. One that moves
      // between rows takes the S, and that is what makes a fork or a merge
      // readable at a glance.
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
        // Folding here keeps everything from this commit forwards; what the
        // line runs down to, and all the history behind it, goes away.
        {
          keep: position + 1,
          hides: history.placed.length - (position + 1),
          from: start,
          to: end,
          shape,
        },
      );
    }
  }

  // What is folded away, and the way to bring it back. `hidden > 0` means the
  // slice was cut short, so there is always an oldest commit for the dash to
  // run to.
  if (history.hidden > 0) {
    const oldest = history.placed[history.placed.length - 1];

    nodes.push({
      id: collapseId(repository),
      type: "collapse",
      parentId: repository.id,
      extent: "parent",
      // The band's own first line, at the head of the first column: the fold
      // is where the history carries on past what is drawn, and the
      // repository's name is set in the air directly over it.
      position: { x: columnX(0), y: historyLine(0) - COMMIT_STEP.y / 2 },
      data: { repository, hidden: history.hidden },
      style: COMMIT_CELL,
      draggable: false,
      selectable: false,
      // Deliberately no z of its own: lifting a node above its row would lift
      // it over the lines its neighbours are drawn on.
    });

    // Joined to the oldest commit still shown, so the line reads as history
    // carrying on off the end rather than starting there. A plain line: what
    // can be done about the fold is on the node it comes out of, which is a
    // button standing where the rest of the history would be.
    drawn.add({
      id: `${repository.id}collapse-edge`,
      from: onCommit(collapseId(repository)),
      to: onCommit(commitNodeId(repository, oldest.commit.id)),
      // The same S every line off the row takes; level ends make it straight.
      shape: "curve",
      trim: COMMIT_TRIM,
      // The fold is a pill centred on this end. Start just past its edge
      // instead of showing the dash through its translucent background.
      lead: FOLD_TRIM,
      stroke: { colour: LINE_COLOR, width: 1.2, opacity: 0.5, dash: "4 5" },
    });
  }

  // A branch is the curve from the commit it points at out to the column every
}

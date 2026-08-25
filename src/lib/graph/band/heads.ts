/**
 * The branch column: one tip commit per branch, the workspace and origin rings
 * layered over it, the named curve from history, and room for its terminals.
 */

import type { PlacedRef } from "../branches";
import { type Point, shortOf } from "../geometry";
import { commitNodeId } from "../history";
import { labelOf } from "../lines";
import {
  CELL_STYLE,
  CLI_STEP,
  LANE_HEIGHT,
  LINE_COLOR,
  onCell,
  onCommit,
  PAIR_DROP,
  PAIR_RING_TRIM,
  RING_TRIM,
  SESSION_WIDTH,
} from "../model";
import type { Frame } from "./frame";

export function drawHeads(frame: Frame, refs: readonly PlacedRef[]) {
  const { repository, history, dots, branchLine, heads, ring, working, drawn, nodes, runs } = frame;

  // like any other, so a branch with no commits of its own still shows up.
  for (const ref of refs) {
    // Where this branch's own mark is. The remote end of a branch hangs a
    // little under the row its local end stands on, which is what makes the
    // pair read as one branch drawn twice rather than as two branches.
    const at: Point = { x: ring, y: branchLine[ref.row] + (ref.under ? PAIR_DROP : 0) };

    nodes.push({
      id: ref.id,
      type: "head",
      parentId: repository.id,
      extent: "parent",
      position: { x: heads, y: at.y - LANE_HEIGHT / 2 },
      data: ref.data,
      style: CELL_STYLE,
      draggable: false,
      selectable: false,
    });

    // Drawn from the commit the branch points at outwards, which is the
    // direction the name reads. The name rides the curve rather than sitting
    // beside the head. This end is a commit now, so the line reaches its centre
    // just like every other history line; the solid dot drawn over it finishes
    // the join, while the workspace and origin remain concentric readings of
    // that same commit.
    const reaches = shortOf(dots[ref.from], at, 0, true);
    drawn.add({
      id: `${ref.id}branch`,
      from: onCommit(commitNodeId(repository, history.placed[ref.from].commit.id)),
      to: onCell(ref.id),
      curve: true,
      trim: 0,
      lead: 0,
      stroke: {
        colour: LINE_COLOR,
        width: 1.1,
        opacity: 0.72,
        // A local branch is drawn solid whether or not it has a directory yet:
        // it is a place you can work in either way, and the worktree is made on
        // the way in. Only a remote-tracking branch is dashed, because that one
        // really is somewhere else.
        dash: ref.data.kind === "remote" ? "4 5" : undefined,
      },
      name: labelOf(ref.data.name, ref.note, dots[ref.from], reaches),
    });

    // Where this branch's terminals stand: a stack centred on the branch's own
    // line, opening out either way as it grows. What is actually in it is
    // `build`'s to fill — the room was made here, because a stack pushes the
    // branches either side of it away and that is the shape of the band.
    //
    // A remote branch is somewhere else: nothing can be opened in it, so
    // nothing stands there.
    if (ref.data.kind !== "remote") {
      runs.push({
        head: ref.id,
        cwd: ref.data.cwd,
        at,
        x: working - SESSION_WIDTH / 2,
        y: at.y - CLI_STEP / 2,
        // A paired branch carries its origin as the outer ring, so the edge to
        // its terminals begins beyond that ring rather than crossing it.
        lead: ref.data.together ? PAIR_RING_TRIM : RING_TRIM,
      });
    }
  }

  // The band is as tall as what is in it and no taller: whichever of the name,
}

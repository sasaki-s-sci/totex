/**
 * The branch column: one node per local, remote, or detached-workspace ref,
 * the named edge from its commit, and room for its terminals.
 */

import type { PlacedRef } from "../branches";
import { type Point, shortOf } from "../geometry";
import { commitNodeId } from "../history";
import { labelOf } from "../lines";
import {
  CLI_STEP,
  COMMIT_STEP,
  COMMIT_TRIM,
  HEAD_CELL,
  LINE_COLOR,
  onCommit,
  onHead,
  REMOTE_HEAD_TRIM,
  RING_TRIM,
  SESSION_WIDTH,
} from "../model";
import type { Frame } from "./frame";

export function drawHeads(frame: Frame, refs: readonly PlacedRef[]) {
  const { repository, history, dots, branchLine, heads, ring, working, drawn, nodes, runs } = frame;

  // like any other, so a branch with no commits of its own still shows up.
  for (const ref of refs) {
    // A head stands on the branch column's own grid row. Several refs from one
    // commit therefore fork onto separate lanes instead of stacking names;
    // only a synchronized local/remote pair was dealt the same row.
    const at: Point = { x: ring, y: branchLine[ref.row] };

    nodes.push({
      id: ref.id,
      type: "head",
      parentId: repository.id,
      extent: "parent",
      position: { x: heads, y: at.y - COMMIT_STEP.y / 2 },
      data: ref.data,
      style: HEAD_CELL,
      draggable: false,
      selectable: false,
    });

    // Drawn from the commit the ref points at outwards, which is the
    // direction the name reads. The name rides the curve rather than sitting
    // beside the head. Stop at the actual ref ring. The source
    // stops at its commit too, so a provisional dashed dot is never crossed.
    const headTrim = ref.data.kind === "remote" ? REMOTE_HEAD_TRIM : RING_TRIM;
    const leaves = shortOf(at, dots[ref.from], COMMIT_TRIM, "curve");
    const reaches = shortOf(dots[ref.from], at, headTrim, "curve");
    drawn.add({
      id: `${ref.id}branch`,
      from: onCommit(commitNodeId(repository, history.placed[ref.from].commit.id)),
      to: onHead(ref.id),
      shape: "curve",
      trim: headTrim,
      lead: COMMIT_TRIM,
      // Two refs at one commit remain distinct. Their coincident edge is split
      // into an upper dashed remote track and a lower solid local track.
      offset: ref.data.together ? (ref.data.kind === "remote" ? -0.8 : 0.8) : undefined,
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
      // Hide only the duplicate name of a synchronized remote. Once the refs
      // diverge, the remote edge names itself so the split can be followed.
      name:
        ref.data.kind === "remote" && ref.data.together
          ? undefined
          : labelOf(ref.data.name, ref.note, leaves, reaches),
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
        lead: RING_TRIM,
      });
    }
  }

  // The band is as tall as what is in it and no taller: whichever of the name,
}

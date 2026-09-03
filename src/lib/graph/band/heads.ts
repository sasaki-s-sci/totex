/**
 * The branch column: one node per local, remote, or detached-workspace ref,
 * the named edge from its commit, and room for its terminals.
 */

import type { PlacedRef } from "../branches";
import { type Point, shortOf } from "../geometry";
import { labelOf } from "../lines";
import {
  CLI_STEP,
  COMMIT_STEP,
  HEAD_CELL,
  JUNCTION_TRIM,
  LINE_COLOR,
  onCommit,
  onHead,
  REMOTE_HEAD_TRIM,
  RING_TRIM,
  SESSION_WIDTH,
} from "../model";
import { FOLD_DASH, type Frame, type Source, sourceOf } from "./frame";

export function drawHeads(frame: Frame, refs: readonly PlacedRef[]) {
  const { repository, bundle, junctionAt, branchLine, heads, ring, working, drawn, nodes, runs } =
    frame;

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

    // Drawn from wherever the branch leaves outwards, which is the direction
    // the name reads: the commit it points at, the fold standing for the
    // history that commit is behind, or — for a name gathered with the others
    // that start the same way — the knot the group fans out of. The name rides
    // the curve rather than sitting beside the head. Stop at the actual ref
    // ring; the source stops at its own mark too, so a provisional dashed dot
    // is never crossed.
    const headTrim = ref.data.kind === "remote" ? REMOTE_HEAD_TRIM : RING_TRIM;
    const gathered = bundle.parentOf.get(ref.id);
    const knot = gathered === undefined ? undefined : junctionAt.get(gathered);
    const source: Source =
      gathered !== undefined && knot !== undefined
        ? { end: onCommit(gathered), at: knot, lead: JUNCTION_TRIM, folded: false }
        : sourceOf(frame, ref.from);
    const leaves = shortOf(at, source.at, source.lead, "curve");
    const reaches = shortOf(source.at, at, headTrim, "curve");
    drawn.add({
      id: `${ref.id}branch`,
      from: source.end,
      to: onHead(ref.id),
      shape: "curve",
      trim: headTrim,
      lead: source.lead,
      // Two refs at one commit remain distinct. Their coincident edge is split
      // into an upper dashed remote track and a lower solid local track.
      offset: ref.data.together ? (ref.data.kind === "remote" ? -0.8 : 0.8) : undefined,
      stroke: {
        colour: LINE_COLOR,
        width: 1.1,
        opacity: 0.72,
        // A local branch is drawn solid whether or not it has a directory yet:
        // it is a place you can work in either way, and the worktree is made on
        // the way in. A remote-tracking branch is dashed because that one really
        // is somewhere else — and so is one whose commit is behind the fold,
        // because the run this line stands for is not on screen either.
        dash: ref.data.kind === "remote" || source.folded ? FOLD_DASH : undefined,
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

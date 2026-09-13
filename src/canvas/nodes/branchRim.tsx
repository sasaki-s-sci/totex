/**
 * The rim of a branch's ring: what is uncommitted in the copy it stands for,
 * cut into the ring's own line.
 */

import type { ReactNode } from "react";
import { HEAD_SIZE } from "../../lib/graph";
import { dirtyCount, type WorktreeStatus } from "../../lib/workspace";

/** The line the ring is drawn on: the width of the button's border, and the
    circle that width is laid along. Both are in the mark's own units, which is
    what the ink's `viewBox` is written in. */
const RING_WIDTH = 1;
const CENTRE = HEAD_SIZE / 2;
const RADIUS = (HEAD_SIZE - RING_WIDTH) / 2;
/** Half a pixel of the circle, as a share of the way round it: what one arc
    has to reach back to cover the join with the one before it. */
const SEAM = 0.5 / (2 * Math.PI * RADIUS);

/**
 * What the rim is made of: the three things that can have become of a file,
 * each holding the share of the circle it holds of the work.
 *
 * Green for what has arrived, orange for what has been rewritten, red for what
 * has gone — the scheme's `added`, `changed` and `removed`, which are the three
 * colours this window already answers in — laid down in that order from the top
 * and read clockwise, so the rim runs from what the branch is making round to
 * what it is throwing away. A branch that is only
 * adding is a green ring at any size, and one that is mostly deleting cannot be
 * mistaken for it.
 *
 * Counted in files rather than in lines: a file is what the eye is going to go
 * looking for afterwards, and a one-line fix to a config and a rewritten module
 * are one file each here rather than the second drowning the first.
 *
 * Drawn as arcs of one circle. It was a conic gradient cut to the width of the
 * ring by a mask, and a mask is a threshold: a pixel is either in it or it is
 * not, so the inside of the rim had no half-covered pixels along it and came
 * out as a staircase. A stroked arc is antialiased like any other path, and
 * sits on the same line the border it replaces was on.
 *
 * Each arc reaches half a pixel back into the one before it, and they are drawn
 * from the last round to the first — so every join is one arc's soft edge lying
 * on the next one's colour, rather than two soft edges meeting over the canvas
 * with a pale pixel of it left between them.
 */
export function rimOf(status: WorktreeStatus | undefined): ReactNode {
  if (!status) return null;

  const total = dirtyCount(status);
  if (total === 0) return null;

  const arcs: { colour: string; from: number; to: number }[] = [];
  let from = 0;
  for (const [count, colour] of [
    [status.added, "var(--mui-palette-success-main)"],
    [status.modified, "var(--mui-palette-warning-main)"],
    [status.deleted, "var(--mui-palette-error-main)"],
  ] as const) {
    if (count === 0) continue;
    from += count / total;
    arcs.push({ colour, from: from - count / total, to: from });
  }
  // The shares are counted off one after another, so the last one ends where
  // the first began however the divisions rounded.
  const last = arcs[arcs.length - 1];
  if (last) last.to = 1;

  return arcs.map(({ colour, from: at, to }) => arc(colour, at, to)).reverse();
}

/**
 * A branch with no worktree, dotted like every offer on this canvas that is not
 * there yet.
 *
 * Ten dashes of its own rather than the browser's: `border-style: dashed` draws
 * dashes as long as the border is thick, which around a ring this small comes
 * to four of them with a quarter of the circle missing between each — a ring
 * that reads as broken rather than as one that is not there yet. `pathLength`
 * makes the circle 360 units round, so the dash and the gap between two dashes
 * are written as the degrees they take.
 */
export function dashes(size = HEAD_SIZE): ReactNode {
  const centre = size / 2;
  const radius = (size - RING_WIDTH) / 2;
  return (
    <circle
      cx={centre}
      cy={centre}
      r={radius}
      pathLength={360}
      strokeDasharray="22 14"
      transform={`rotate(-90 ${centre} ${centre})`}
    />
  );
}

/**
 * One share of the rim, from `from` to `to` of the way round, clockwise from
 * the top.
 *
 * `pathLength` makes the circle one unit round, so a share is the dash and what
 * is left of the circle is the gap. The dash starts half a pixel early: what is
 * under that half pixel is the arc drawn before this one, and covering it is
 * what keeps the canvas from showing between two colours.
 */
function arc(colour: string, from: number, to: number): ReactNode {
  const dash = Math.min(to - from + SEAM, 1);
  return (
    <circle
      key={colour}
      cx={CENTRE}
      cy={CENTRE}
      r={RADIUS}
      stroke={colour}
      pathLength={1}
      // A share that is the whole circle has nothing to cut into it.
      strokeDasharray={dash < 1 ? `${dash} ${1 - dash}` : undefined}
      strokeDashoffset={dash < 1 ? SEAM - from : undefined}
      transform={`rotate(-90 ${CENTRE} ${CENTRE})`}
    />
  );
}

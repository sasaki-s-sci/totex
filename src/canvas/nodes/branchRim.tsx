import type { ReactNode } from "react";
import { HEAD_SIZE } from "../../lib/graph";
import { dirtyCount, type WorktreeStatus } from "../../lib/workspace";

const RING_WIDTH = 1;
const CENTRE = HEAD_SIZE / 2;
const RADIUS = (HEAD_SIZE - RING_WIDTH) / 2;
// Half a pixel of the circle: how far each arc reaches back over the one before it.
const SEAM = 0.5 / (2 * Math.PI * RADIUS);

// Stroked arcs rather than a masked conic gradient, which staircases: a mask has no half-covered pixels.
// Arcs are drawn last to first so every join is one soft edge over the next colour, never a bare canvas pixel.
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
  const last = arcs[arcs.length - 1];
  if (last) last.to = 1;

  return arcs.map(({ colour, from: at, to }) => arc(colour, at, to)).reverse();
}

// Own dashes via pathLength: `border-style: dashed` gives four long dashes on a ring this small.
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
      strokeDasharray={dash < 1 ? `${dash} ${1 - dash}` : undefined}
      strokeDashoffset={dash < 1 ? SEAM - from : undefined}
      transform={`rotate(-90 ${CENTRE} ${CENTRE})`}
    />
  );
}

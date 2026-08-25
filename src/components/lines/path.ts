/**
 * One batch of lines, as the `d` of a single path.
 */

import type { XYPosition } from "@xyflow/react";
import {
  type GraphLine,
  type LineEnd,
  type Point,
  type StrokeStyle,
  shortOf,
  sigmoidPath,
  straightPath,
} from "../../lib/graph";

/**
 * A run of lines as one piece of path data.
 *
 * Every line drawn the same way is a piece of the same path, which is what
 * makes a repository a dozen elements instead of one per commit. A line whose
 * ends are not both on the canvas is left out rather than drawn to nowhere.
 *
 * Both ends are pulled back off the marks they belong to, by the same sum from
 * either direction: `trim` for the far one, which is what keeps a line from
 * being drawn across the hole in a ring, and `lead` for the near one, which is
 * what keeps a line out of the box a terminal is drawn in. The ring of canvas
 * every mark carries covers what is left between the line and the mark.
 */
export function pathOf(
  parts: readonly GraphLine[],
  standing: ReadonlyMap<string, XYPosition>,
): string {
  let path = "";
  for (const part of parts) {
    const from = endOf(part.from, standing);
    const to = endOf(part.to, standing);
    if (!from || !to) continue;
    // The same sum with the ends swapped: `shortOf` pulls the second point back
    // towards the first, which from this direction is the start of the line.
    const start = shortOf(to, from, part.lead, part.curve);
    const end = shortOf(from, to, part.trim, part.curve);
    path += part.curve ? sigmoidPath(start, end) : straightPath(start, end);
    path += " ";
  }
  return path;
}

/**
 * Where one end of a line is: the middle of the mark it belongs to.
 *
 * A band's own lines are drawn inside the band's transform and their ends are
 * the commits in it, so a node's position — which React Flow keeps relative to
 * whatever it is placed in — is already the answer either way. A line into a
 * row names the band itself and the point inside it, which is the same sum.
 */
function endOf(end: LineEnd, standing: ReadonlyMap<string, XYPosition>): Point | null {
  const at = standing.get(end.node);
  return at ? { x: at.x + end.dx, y: at.y + end.dy } : null;
}

/** How a batch is drawn. The same shape for every path on the canvas. */
export function stroke(style: StrokeStyle) {
  return {
    fill: "none",
    stroke: style.colour,
    strokeWidth: style.width,
    strokeOpacity: style.opacity,
    strokeDasharray: style.dash,
  };
}

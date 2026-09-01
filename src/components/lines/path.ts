/**
 * One batch of lines, as the `d` of a single path.
 */

import type { XYPosition } from "@xyflow/react";
import {
  downFrom,
  elbowPath,
  type GraphLine,
  type LineEnd,
  type LineShape,
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
 * Both ends are pulled back off the marks they belong to: `trim` for the far
 * one, which is what keeps a line from being drawn across the hole in a ring,
 * and `lead` for the near one, which is what keeps a line out of the box a
 * terminal is drawn in. The ring of canvas every mark carries covers what is
 * left between the line and the mark.
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
    // The far end is the same sum with the ends swapped: `shortOf` pulls the
    // second point back towards the first. The near end depends on the
    // direction the line leaves in, which for an elbow is straight down its own
    // column rather than towards anything.
    const start =
      part.shape === "elbow"
        ? downFrom(from, to, part.lead)
        : shortOf(to, from, part.lead, part.shape);
    const end = shortOf(from, to, part.trim, part.shape);
    offset(start, end, part.offset ?? 0);
    path += pieceOf(part.shape, start, end);
    path += " ";
  }
  return path;
}

/** One line as path data, in whichever of the three shapes it takes. */
function pieceOf(shape: LineShape, start: Point, end: Point): string {
  if (shape === "curve") return sigmoidPath(start, end);
  if (shape === "elbow") return elbowPath(start, end);
  return straightPath(start, end);
}

/** Move both ends along the line's normal. Positive is below a left-to-right
 *  line, so coincident local and remote strokes can each keep half the track. */
function offset(start: Point, end: Point, distance: number): void {
  if (distance === 0) return;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return;
  const x = (-dy / length) * distance;
  const y = (dx / length) * distance;
  start.x += x;
  start.y += y;
  end.x += x;
  end.y += y;
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

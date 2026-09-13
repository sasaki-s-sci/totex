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

export function pathOf(
  parts: readonly GraphLine[],
  standing: ReadonlyMap<string, XYPosition>,
): string {
  let path = "";
  for (const part of parts) {
    const ends = endsOf(part, standing);
    if (!ends) continue;
    path += pieceOf(part.shape, ends.start, ends.end);
    path += " ";
  }
  return path;
}

export function endsOf(
  part: GraphLine,
  standing: ReadonlyMap<string, XYPosition>,
): { start: Point; end: Point } | null {
  const from = endOf(part.from, standing);
  const to = endOf(part.to, standing);
  if (!from || !to) return null;

  const start =
    part.shape === "elbow"
      ? downFrom(from, to, part.lead)
      : shortOf(to, from, part.lead, part.shape);
  const end = shortOf(from, to, part.trim, part.shape);
  offset(start, end, part.offset ?? 0);
  return { start, end };
}

function pieceOf(shape: LineShape, start: Point, end: Point): string {
  if (shape === "curve") return sigmoidPath(start, end);
  if (shape === "elbow") return elbowPath(start, end);
  return straightPath(start, end);
}

/** Positive moves below a left-to-right line, so local and remote strokes each keep half the track. */
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

/** A band's lines are drawn inside the band's transform, so node positions are already relative to it. */
function endOf(end: LineEnd, standing: ReadonlyMap<string, XYPosition>): Point | null {
  const at = standing.get(end.node);
  return at ? { x: at.x + end.dx, y: at.y + end.dy } : null;
}

export function stroke(style: StrokeStyle) {
  return {
    fill: "none",
    stroke: style.colour,
    strokeWidth: style.width,
    strokeOpacity: style.opacity,
    strokeDasharray: style.dash,
  };
}

// Line arithmetic in layout units, so hit testing is the same answer at every zoom.

// Both control points share one x, so a curve leaves flat, turns once, arrives flat.
const LATE_BEND = 0.55;
const EARLY_BEND = 0.26;
// Rise over run past which the turn comes early.
const STEEP = 1.6;

export type Point = { x: number; y: number };

/** `elbow` is the one non-history shape: a folder square down to what it holds. */
export type LineShape = "straight" | "curve" | "elbow";

// The steeper the climb, the earlier the turn: lines fanning out of one commit
// then spread as nested arcs instead of overlapping, and cannot cross.
function bendOf(source: Point, target: Point): number {
  const run = Math.abs(target.x - source.x);
  const rise = Math.abs(target.y - source.y);
  if (run === 0) return LATE_BEND;

  // Eased, so two branches a row apart do not leave at visibly different angles.
  const steepness = Math.min(1, rise / run / STEEP);
  return LATE_BEND + (EARLY_BEND - LATE_BEND) * steepness * steepness;
}

export function sigmoidPath(source: Point, target: Point): string {
  const bendX = source.x + (target.x - source.x) * bendOf(source, target);
  return `M ${source.x},${source.y} C ${bendX},${source.y} ${bendX},${target.y} ${target.x},${target.y}`;
}

export function straightPath(source: Point, target: Point): string {
  return `M ${source.x},${source.y} L ${target.x},${target.y}`;
}

export function elbowPath(source: Point, target: Point): string {
  return `M ${source.x},${source.y} V ${target.y} H ${target.x}`;
}

// One path for a whole history: an element per dot was most of a frame's cost.
// Two half-arcs off their own `M` keep each circle a separate piece.
export function circlesOf(points: readonly Point[], radius: number): string {
  let path = "";
  for (const point of points) {
    path += `M ${point.x - radius} ${point.y} a ${radius} ${radius} 0 1 0 ${radius * 2} 0 a ${radius} ${radius} 0 1 0 ${-radius * 2} 0 `;
  }
  return path;
}

// The S is not symmetric about the chord, so the midpoint is taken on the curve.
export function midpointOf(source: Point, target: Point, shape: LineShape): Point {
  const y = (source.y + target.y) / 2;
  if (shape === "straight") return { x: (source.x + target.x) / 2, y };

  if (shape === "elbow") {
    const down = Math.abs(target.y - source.y);
    const across = Math.abs(target.x - source.x);
    const half = (down + across) / 2;
    return half <= down
      ? { x: source.x, y: source.y + Math.sign(target.y - source.y) * half }
      : { x: source.x + Math.sign(target.x - source.x) * (half - down), y: target.y };
  }

  const bendX = source.x + (target.x - source.x) * bendOf(source, target);
  return { x: (source.x + target.x + 6 * bendX) / 8, y };
}

/** The far end pulled back by `by`, so a line stops at a ring's rim. */
export function shortOf(source: Point, target: Point, by: number, shape: LineShape): Point {
  if (by <= 0) return target;
  // Curve and elbow both arrive horizontally.
  if (shape !== "straight") {
    return { x: target.x - Math.sign(target.x - source.x) * by, y: target.y };
  }

  const run = { x: target.x - source.x, y: target.y - source.y };
  const span = Math.hypot(run.x, run.y) || 1;
  return { x: target.x - (run.x / span) * by, y: target.y - (run.y / span) * by };
}

/** The near end of an elbow stepped down its own vertical. */
export function downFrom(source: Point, target: Point, by: number): Point {
  if (by <= 0) return source;
  if (target.y === source.y) return shortOf(target, source, by, "elbow");
  return { x: source.x, y: source.y + Math.sign(target.y - source.y) * by };
}

// Eight pieces is past where the chord error is a pixel at any allowed zoom.
const SAMPLES = 8;

/** Flat [x, y, ...] rather than point objects: thousands of these per repository. */
export function samplesOf(source: Point, target: Point, shape: LineShape): number[] {
  if (shape === "straight") return [source.x, source.y, target.x, target.y];
  if (shape === "elbow") return [source.x, source.y, source.x, target.y, target.x, target.y];

  const bendX = source.x + (target.x - source.x) * bendOf(source, target);
  const run: number[] = [];
  for (let step = 0; step <= SAMPLES; step++) {
    const at = step / SAMPLES;
    const rest = 1 - at;
    // The same cubic `sigmoidPath` emits, not an approximation of it.
    run.push(
      rest * rest * rest * source.x +
        3 * rest * rest * at * bendX +
        3 * rest * at * at * bendX +
        at * at * at * target.x,
      rest * rest * rest * source.y +
        3 * rest * rest * at * source.y +
        3 * rest * at * at * target.y +
        at * at * at * target.y,
    );
  }
  return run;
}

/** Distance to the run, or `Infinity` past `limit`; stops early once within it. */
export function distanceTo(run: readonly number[], at: Point, limit: number): number {
  let best = Infinity;
  for (let index = 0; index + 3 < run.length; index += 2) {
    const gap = toSegment(at, run[index], run[index + 1], run[index + 2], run[index + 3]);
    if (gap < best) best = gap;
    if (best <= limit) return best;
  }
  return best <= limit ? best : Infinity;
}

function toSegment(at: Point, x1: number, y1: number, x2: number, y2: number): number {
  const runX = x2 - x1;
  const runY = y2 - y1;
  const span = runX * runX + runY * runY;
  const along =
    span === 0 ? 0 : Math.max(0, Math.min(1, ((at.x - x1) * runX + (at.y - y1) * runY) / span));
  return Math.hypot(at.x - (x1 + along * runX), at.y - (y1 + along * runY));
}

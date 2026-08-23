/**
 * The shapes a line of the graph can take, and the sums that go with them.
 *
 * Nothing here draws anything or reads a repository: it is the arithmetic
 * between two cells of the grid, which the layout does once and the canvas then
 * only hands to the engine. Sampling and hit testing live here for the same
 * reason — what the pointer is over is a question about geometry, and answering
 * it in the layout's own units keeps it the same answer at every zoom.
 */

/**
 * Where a line barely off its own row turns, as a fraction of the horizontal
 * run.
 *
 * Both control points share this x, so the curve leaves its start flat, turns
 * once, and arrives flat — just past the middle, which puts the turn nearer the
 * head a branch runs out to than the commit it was cut from.
 */
const LATE_BEND = 0.55;
/**
 * Where a line with a long way to climb turns instead.
 *
 * Earlier, so that it is moving from the outset and has flattened out well
 * before its far end.
 */
const EARLY_BEND = 0.26;
/**
 * How steep a line has to be before it turns at `EARLY_BEND` rather than at
 * `LATE_BEND` — rise over run, so one row per column is 0.48.
 */
const STEEP = 1.6;

export type Point = { x: number; y: number };

/**
 * Where the curve turns, as a fraction of the horizontal run.
 *
 * The steeper the climb, the earlier the turn. A dozen branches cut at one
 * commit all leave the same point with the same run to make it in, so a turn
 * fixed at one fraction laid every one of them over the next for the first
 * third of the way and then sent them off as a sheaf of near-vertical shards.
 * Turning sooner the further a line has to go spreads them the moment they
 * leave: the line climbing eight rows is already climbing while the one
 * climbing a single row is still flat, so they read as a fan of nested arcs.
 *
 * That order is also why the fan cannot cross itself. Both ends and the run are
 * shared, so at any x along it a line is further from the row it left exactly
 * when it turned earlier and has further to go — and this makes those the same
 * lines.
 */
function bendOf(source: Point, target: Point): number {
  const run = Math.abs(target.x - source.x);
  const rise = Math.abs(target.y - source.y);
  if (run === 0) return LATE_BEND;

  // Eased rather than cut off at `STEEP`, so that two branches a row apart do
  // not leave at visibly different angles.
  const steepness = Math.min(1, rise / run / STEEP);
  return LATE_BEND + (EARLY_BEND - LATE_BEND) * steepness * steepness;
}

/**
 * The S a link takes between two points.
 *
 * That is the shape a branch actually makes — it runs along its row, crosses
 * over, and settles into the next — and it degenerates to a straight line when
 * the two ends share a row.
 */
export function sigmoidPath(source: Point, target: Point): string {
  const bendX = source.x + (target.x - source.x) * bendOf(source, target);
  return `M ${source.x},${source.y} C ${bendX},${source.y} ${bendX},${target.y} ${target.x},${target.y}`;
}

export function straightPath(source: Point, target: Point): string {
  return `M ${source.x},${source.y} L ${target.x},${target.y}`;
}

/**
 * Many circles as independent pieces of one path.
 *
 * A dot on this canvas is a fixed-size circle on a grid, and a repository holds
 * a thousand of them. Given to the engine one element apiece they were the
 * greater part of what a frame cost, so a repository's whole history is drawn
 * as one path instead. Each circle is two half-arcs off its own `M`, which is
 * what keeps them separate pieces rather than one shape with the gaps filled
 * in.
 */
export function circlesOf(points: readonly Point[], radius: number): string {
  let path = "";
  for (const point of points) {
    path += `M ${point.x - radius} ${point.y} a ${radius} ${radius} 0 1 0 ${radius * 2} 0 a ${radius} ${radius} 0 1 0 ${-radius * 2} 0 `;
  }
  return path;
}

/**
 * The middle of a line, wherever the line itself goes.
 *
 * The S turns past halfway, so it is not symmetric about the straight line
 * between its two ends: a mark set on the middle of that straight line sits
 * beside the curve rather than on it, and the line then runs out from under the
 * disc the mark is drawn on.
 */
export function midpointOf(source: Point, target: Point, curve: boolean): Point {
  const y = (source.y + target.y) / 2;
  if (!curve) return { x: (source.x + target.x) / 2, y };

  // The curve at its halfway point, with both control points on `bendX`.
  const bendX = source.x + (target.x - source.x) * bendOf(source, target);
  return { x: (source.x + target.x + 6 * bendX) / 8, y };
}

/**
 * The far end of a line, pulled back by `by`.
 *
 * Lines are drawn between the centres of the cells they join, which is right
 * for a commit — the dot is solid and covers the last of it — and wrong for a
 * branch head, which is a ring with nothing inside it. So a line that ends on a
 * ring stops at its rim instead of being drawn across the hole.
 */
export function shortOf(source: Point, target: Point, by: number, curve: boolean): Point {
  if (by <= 0) return target;
  // The S arrives flat, so its last stretch is horizontal whatever the rows did.
  if (curve) {
    return { x: target.x - Math.sign(target.x - source.x) * by, y: target.y };
  }

  const run = { x: target.x - source.x, y: target.y - source.y };
  const span = Math.hypot(run.x, run.y) || 1;
  return { x: target.x - (run.x / span) * by, y: target.y - (run.y / span) * by };
}

/**
 * How many straight pieces a curve is chopped into for the pointer's sake.
 *
 * The chopped line is never drawn — the engine draws the curve itself — it is
 * only what "is the cursor on this line" is answered against. Eight is past the
 * point where the difference is a pixel at any zoom the canvas allows.
 */
const SAMPLES = 8;

/**
 * The line as a run of points, for asking what the pointer is over.
 *
 * Flat rather than a list of pairs: there is one of these per line of history
 * and a repository has thousands, so this is the difference between an array
 * and eight objects per line.
 */
export function samplesOf(source: Point, target: Point, curve: boolean): number[] {
  if (!curve) return [source.x, source.y, target.x, target.y];

  const bendX = source.x + (target.x - source.x) * bendOf(source, target);
  const run: number[] = [];
  for (let step = 0; step <= SAMPLES; step++) {
    const at = step / SAMPLES;
    const rest = 1 - at;
    // The cubic the `C` in `sigmoidPath` describes, with both control points on
    // `bendX` — so this is that same curve and not an approximation of it.
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

/**
 * How far the point is from the run, or `Infinity` past `limit`.
 *
 * The limit is what makes this cheap: a line whose first piece is already too
 * far away is dropped without the rest of it being measured, and the pointer is
 * usually nowhere near the great majority of them.
 */
export function distanceTo(run: readonly number[], at: Point, limit: number): number {
  let best = Infinity;
  for (let index = 0; index + 3 < run.length; index += 2) {
    const gap = toSegment(at, run[index], run[index + 1], run[index + 2], run[index + 3]);
    if (gap < best) best = gap;
    if (best <= limit) return best;
  }
  return best <= limit ? best : Infinity;
}

/** Distance from a point to one straight piece. */
function toSegment(at: Point, x1: number, y1: number, x2: number, y2: number): number {
  const runX = x2 - x1;
  const runY = y2 - y1;
  const span = runX * runX + runY * runY;
  // How far along the piece the nearest point is, kept on the piece itself.
  const along =
    span === 0 ? 0 : Math.max(0, Math.min(1, ((at.x - x1) * runX + (at.y - y1) * runY) / span));
  return Math.hypot(at.x - (x1 + along * runX), at.y - (y1 + along * runY));
}

/** The box a run of points fits in, which is what the grid is filled from. */
export function boundsOf(run: readonly number[]): {
  left: number;
  top: number;
  right: number;
  bottom: number;
} {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (let index = 0; index + 1 < run.length; index += 2) {
    if (run[index] < left) left = run[index];
    if (run[index] > right) right = run[index];
    if (run[index + 1] < top) top = run[index + 1];
    if (run[index + 1] > bottom) bottom = run[index + 1];
  }
  return { left, top, right, bottom };
}

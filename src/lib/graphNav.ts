import type { AppNode } from "./graph";

/** A node the cursor keys can land on, at its centre on the canvas. */
export type Pickable = {
  id: string;
  x: number;
  y: number;
};

/**
 * How far off the straight line a candidate may be, per unit travelled towards
 * it.
 *
 * The graph is rows of history: pressing right should walk along the row it is
 * on, not jump to whatever happens to be nearest overall. Weighting the sideways
 * distance is what keeps the walk on its line while still allowing the step to a
 * branch that is genuinely the next thing along.
 */
const ACROSS_WEIGHT = 3;
/** Below this, two nodes count as level with one another rather than apart. */
const LEVEL = 4;

/**
 * Everything on the canvas that can be picked, with its centre in canvas
 * coordinates.
 *
 * Bands are not pickable — a repository is a backdrop, not a thing to open — but
 * they carry the position everything inside them is relative to.
 */
export function pickables(nodes: readonly AppNode[]): Pickable[] {
  const bands = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    if (node.type === "repository") bands.set(node.id, node.position);
  }

  const picks: Pickable[] = [];
  for (const node of nodes) {
    if (node.type === "repository") continue;
    const band = node.parentId ? bands.get(node.parentId) : undefined;
    const width = Number(node.style?.width ?? 0);
    const height = Number(node.style?.height ?? 0);
    picks.push({
      id: node.id,
      x: (band?.x ?? 0) + node.position.x + width / 2,
      y: (band?.y ?? 0) + node.position.y + height / 2,
    });
  }
  return picks;
}

/**
 * The node a cursor key lands on: the nearest one that really is in that
 * direction, counting sideways distance against a candidate.
 */
export function step(
  from: Pickable,
  picks: readonly Pickable[],
  direction: { x: number; y: number },
): Pickable | null {
  let best: Pickable | null = null;
  let score = Number.POSITIVE_INFINITY;

  for (const pick of picks) {
    if (pick.id === from.id) continue;
    const along = (pick.x - from.x) * direction.x + (pick.y - from.y) * direction.y;
    if (along <= LEVEL) continue;
    const across = Math.abs((pick.x - from.x) * direction.y - (pick.y - from.y) * direction.x);
    const candidate = along + ACROSS_WEIGHT * across;
    if (candidate < score) {
      score = candidate;
      best = pick;
    }
  }

  return best;
}

/** Where a node sits on the canvas, for anything that has to point at it. */
export function centreOf(nodes: readonly AppNode[], id: string): { x: number; y: number } {
  const wanted = nodes.find((node) => node.id === id);
  if (!wanted || wanted.type === "repository") return { x: 0, y: 0 };

  const band = wanted.parentId
    ? nodes.find((node) => node.type === "repository" && node.id === wanted.parentId)?.position
    : undefined;
  const width = Number(wanted.style?.width ?? 0);
  const height = Number(wanted.style?.height ?? 0);
  return {
    x: (band?.x ?? 0) + wanted.position.x + width / 2,
    y: (band?.y ?? 0) + wanted.position.y + height / 2,
  };
}

/** Where a walk starts when nothing has been picked yet: the top left of it. */
export function first(picks: readonly Pickable[]): Pickable | null {
  let best: Pickable | null = null;
  for (const pick of picks) {
    if (!best || pick.y < best.y || (pick.y === best.y && pick.x < best.x)) best = pick;
  }
  return best;
}

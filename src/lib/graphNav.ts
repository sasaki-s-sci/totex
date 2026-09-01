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

/**
 * The terminals on the canvas, top to bottom.
 *
 * The order Ctrl and a number reach them in: a mark's number is its place down
 * the canvas, so it is read off what is drawn rather than out of the order the
 * sessions happen to have been opened in — the numbers then run down the window
 * the way the eye does, and two terminals level with one another are numbered
 * left to right.
 *
 * The bands are handed through with them because a terminal standing in one is
 * positioned against it; `pickables` is where that offset is worked out, and it
 * draws nothing for a band itself.
 */
export function jumpable(nodes: readonly AppNode[]): Pickable[] {
  const stacks = nodes.filter((node) => node.type === "cli" || node.type === "repository");
  return pickables(stacks).sort((one, other) => one.y - other.y || one.x - other.x);
}

/**
 * One terminal in the run the panel's strip draws, in the order the numbers are
 * given out.
 */
export type CliPlace = {
  /** The session's own id, which is what the panel knows a terminal by. */
  session: string;
  /** The row it is hanging on, which is where the run is broken by a gap. */
  group: string;
};

/**
 * Every terminal on the canvas, read the way the numbers are.
 *
 * The same list `jumpable` hands the keys, said in what the panel knows rather
 * than in nodes: a session's id and the row it is standing on. A place in this
 * run is the number that reaches it — Ctrl and that number — so the strip and
 * the key cannot drift apart, because they are one reading of one canvas.
 */
export function cliRun(nodes: readonly AppNode[]): CliPlace[] {
  const marks = new Map(
    nodes.flatMap((node) => (node.type === "cli" ? [[node.id, node.data] as const] : [])),
  );
  return jumpable(nodes).flatMap((pick) => {
    const mark = marks.get(pick.id);
    return mark ? [{ session: mark.session.id, group: mark.group }] : [];
  });
}

/**
 * The commits on the canvas.
 *
 * What Ctrl and Shift and an arrow walks through, and the one thing it walks
 * through: the history is what is being read out here, and a branch/workspace
 * node is no longer a second copy of its commit. A walk from an open terminal
 * resolves that ref back to the real commit before it enters this list.
 *
 * The bands come along for the same reason they do in `jumpable`: a commit is
 * positioned against the repository it belongs to, and `pickables` is where that
 * offset is worked out.
 */
export function history(nodes: readonly AppNode[]): Pickable[] {
  return pickables(nodes.filter((node) => node.type === "commit" || node.type === "repository"));
}

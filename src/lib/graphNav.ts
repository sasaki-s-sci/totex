import type { AppNode, OfferFlowNode } from "./graph";

export type Pickable = {
  id: string;
  x: number;
  y: number;
};

// Sideways distance is penalised so Right walks along the row rather than to the nearest node.
const ACROSS_WEIGHT = 3;
const LEVEL = 4;

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

/**
 * Walks the numbers, not the geometry: every terminal is reachable in Ctrl+digit order, wrapping at
 * both ends.
 */
export function neighbour(
  standing: string | null,
  stacks: readonly Pickable[],
  by: 1 | -1,
): Pickable | null {
  if (stacks.length === 0) return null;
  const place = standing ? stacks.findIndex((stack) => stack.id === standing) : -1;
  if (place < 0) return by > 0 ? stacks[0] : stacks[stacks.length - 1];
  return stacks[(place + by + stacks.length) % stacks.length];
}

export function first(picks: readonly Pickable[]): Pickable | null {
  let best: Pickable | null = null;
  for (const pick of picks) {
    if (!best || pick.y < best.y || (pick.y === best.y && pick.x < best.x)) best = pick;
  }
  return best;
}

/** Top to bottom, then left to right: the order Ctrl+digit reads. */
export function jumpable(nodes: readonly AppNode[]): Pickable[] {
  const stacks = nodes.filter((node) => node.type === "cli" || node.type === "repository");
  return pickables(stacks).sort((one, other) => one.y - other.y || one.x - other.x);
}

export type CliPlace = {
  session: string;
  group: string;
  name: string;
};

export function cliRun(nodes: readonly AppNode[]): CliPlace[] {
  const marks = new Map(
    nodes.flatMap((node) => (node.type === "cli" ? [[node.id, node.data] as const] : [])),
  );
  const names = new Map(
    nodes.flatMap((node) => {
      if (node.type === "repository" || node.type === "repo-mark") {
        return [[node.id, node.data.repository.name] as const];
      }
      return node.type === "folder" ? [[node.id, node.data.name] as const] : [];
    }),
  );
  return jumpable(nodes).flatMap((pick) => {
    const mark = marks.get(pick.id);
    if (!mark) return [];
    return [{ session: mark.session.id, group: mark.group, name: names.get(mark.group) ?? "" }];
  });
}

/** Where each offer would stand; the bands are read for the ones standing in a band. */
export function offered(nodes: readonly AppNode[], offers: readonly OfferFlowNode[]): Pickable[] {
  return pickables([...nodes.filter((node) => node.type === "repository"), ...offers]);
}

export function nearest(from: Pickable, picks: readonly Pickable[]): Pickable | null {
  let best: Pickable | null = null;
  let score = Number.POSITIVE_INFINITY;
  for (const pick of picks) {
    const away = Math.hypot(pick.x - from.x, pick.y - from.y);
    if (away < score) {
      score = away;
      best = pick;
    }
  }
  return best;
}

/** The canvas re-reads the run per graph; an unchanged reading must not re-render the window. */
export function sameCliRun(held: readonly CliPlace[], next: readonly CliPlace[]): boolean {
  return (
    held.length === next.length &&
    held.every((place, at) => {
      const against = next[at];
      return (
        place.session === against?.session &&
        place.group === against.group &&
        place.name === against.name
      );
    })
  );
}

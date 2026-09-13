// Branches sharing a name prefix leave the history through one knot. Junctions
// take whole grid columns so the branch column and everything past it stay put:
// one column for two junctions or fewer, one more per two after that.

import type { PlacedRef } from "./branches";

export type Junction = {
  id: string;
  /** Without its trailing slash: `dev`, `dev/api`. */
  prefix: string;
  /** Zero-based; the depth of the prefix. */
  column: number;
  parent: string | null;
  /** Branch rows gathered under it, nested ones included. */
  members: number;
  /** Pressed shut: the knot stays, the branches under it leave the column unless running. */
  closed: boolean;
};

export type Bundle = {
  /** Shallowest first, so a parent is placed before its children. */
  junctions: Junction[];
  /** By ref id, drawn or not: a ref under a shut knot still names it. */
  parentOf: ReadonlyMap<string, string>;
  width: number;
  /** Under a shut knot and not running. */
  hidden: ReadonlySet<string>;
};

export type Shutting = {
  closed: ReadonlySet<string>;
  running: (ref: PlacedRef) => boolean;
};

const EMPTY_BUNDLE: Bundle = {
  junctions: [],
  parentOf: new Map(),
  width: 0,
  hidden: new Set(),
};

const NOTHING_SHUT: Shutting = { closed: new Set(), running: () => false };

const PER_COLUMN = 2;

// Read off the logical name, so a branch and its remote end are one member
// and `origin` is never a namespace.
export function bundleBranches(
  repositoryId: string,
  refs: readonly PlacedRef[],
  shutting: Shutting = NOTHING_SHUT,
): Bundle {
  // By row, not ref: a branch and its remote end share a row.
  const rows = new Map<string, Set<number>>();
  for (const ref of refs) {
    for (const prefix of prefixesOf(ref.group)) {
      const held = rows.get(prefix);
      if (held) held.add(ref.row);
      else rows.set(prefix, new Set([ref.row]));
    }
  }

  const gathering = [...rows].filter(([, held]) => held.size > 1).map(([prefix]) => prefix);

  // A namespace deeper than the columns allow gathers at its first word, which
  // always exists; pruning must follow, since `dev` only matters once `dev/api` is out.
  const columns = Math.max(1, Math.ceil(gathering.length / PER_COLUMN));
  const gathered = pruned(new Set(gathering.filter((prefix) => depthOf(prefix) <= columns)), refs);
  if (gathered.size === 0) return EMPTY_BUNDLE;

  // Width is settled before shutting, so pressing a knot moves nothing else.
  const width = [...gathered].reduce((deepest, prefix) => Math.max(deepest, depthOf(prefix)), 0);

  // A shut knot hides the knots under it too; refs hang off the nearest kept one.
  const shut = new Set(
    [...gathered].filter((prefix) => shutting.closed.has(junctionId(repositoryId, prefix))),
  );
  const kept = new Set([...gathered].filter((prefix) => holder(shut, prefix) === null));

  const working = new Set(refs.filter((ref) => shutting.running(ref)).map((ref) => ref.row));

  const parentOf = new Map<string, string>();
  const members = new Map<string, number>();
  const hidden = new Set<string>();
  for (const ref of refs) {
    const over = holder(kept, ref.group);
    if (over === null) continue;
    parentOf.set(ref.id, junctionId(repositoryId, over));
    if (shut.has(over) && !working.has(ref.row)) hidden.add(ref.id);
    for (const prefix of prefixesOf(ref.group)) {
      if (kept.has(prefix)) members.set(prefix, (members.get(prefix) ?? 0) + 1);
    }
  }

  const junctions = [...kept]
    .sort((left, right) => depthOf(left) - depthOf(right) || (left < right ? -1 : 1))
    .map((prefix) => ({
      id: junctionId(repositoryId, prefix),
      prefix,
      column: depthOf(prefix) - 1,
      parent: above(kept, prefix, repositoryId),
      members: members.get(prefix) ?? 0,
      closed: shut.has(prefix),
    }));

  return { junctions, parentOf, width, hidden };
}

export type Column = {
  refs: PlacedRef[];
  rows: number;
  /** The row a shut knot with nothing left under it takes, by junction id. */
  seats: ReadonlyMap<string, number>;
};

// Rows close up in dealt order. A shut knot with nothing drawn under it takes
// the row of its first branch; one with a running branch under it takes none.
export function dealColumn(refs: readonly PlacedRef[], bundle: Bundle): Column {
  const covered = new Set<string>();
  for (const ref of refs) {
    const over = bundle.parentOf.get(ref.id);
    if (over !== undefined && !bundle.hidden.has(ref.id)) covered.add(over);
  }

  const taken = new Map<number, number>();
  const seats = new Map<string, number>();
  const drawn: PlacedRef[] = [];
  const row = (of: number) => {
    const held = taken.get(of);
    if (held !== undefined) return held;
    const next = taken.size + seats.size;
    taken.set(of, next);
    return next;
  };

  for (const ref of [...refs].sort((left, right) => left.row - right.row)) {
    if (!bundle.hidden.has(ref.id)) {
      drawn.push({ ...ref, row: row(ref.row) });
      continue;
    }
    const over = bundle.parentOf.get(ref.id);
    if (over === undefined || covered.has(over) || seats.has(over)) continue;
    seats.set(over, taken.size + seats.size);
  }

  return { refs: drawn, rows: taken.size + seats.size, seats };
}

export function junctionId(repositoryId: string, prefix: string): string {
  return `${repositoryId}junction${prefix}`;
}

// The whole name is not a prefix: a branch does not gather itself.
function prefixesOf(name: string): string[] {
  const parts = name.split("/");
  const prefixes: string[] = [];
  for (let cut = 1; cut < parts.length; cut++) prefixes.push(parts.slice(0, cut).join("/"));
  return prefixes;
}

function depthOf(prefix: string): number {
  return prefix.split("/").length;
}

function holder(kept: ReadonlySet<string>, name: string): string | null {
  let found: string | null = null;
  for (const prefix of prefixesOf(name)) {
    if (kept.has(prefix)) found = prefix;
  }
  return found;
}

function above(kept: ReadonlySet<string>, prefix: string, repositoryId: string): string | null {
  const over = holder(kept, prefix);
  return over === null ? null : junctionId(repositoryId, over);
}

// A junction gathering one thing is dropped; dropping one can leave its parent
// gathering one thing, hence the loop.
function pruned(candidates: ReadonlySet<string>, refs: readonly PlacedRef[]): Set<string> {
  let kept = new Set(candidates);
  for (;;) {
    const under = new Map<string, Set<string>>();
    const add = (parent: string, child: string) => {
      const held = under.get(parent);
      if (held) held.add(child);
      else under.set(parent, new Set([child]));
    };

    for (const ref of refs) {
      const over = holder(kept, ref.group);
      if (over !== null) add(over, `row${ref.row}`);
    }
    for (const prefix of kept) {
      const over = holder(kept, prefix);
      if (over !== null) add(over, prefix);
    }

    const left = new Set([...kept].filter((prefix) => (under.get(prefix)?.size ?? 0) > 1));
    if (left.size === kept.size) return left;
    kept = left;
  }
}

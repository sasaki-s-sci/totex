/**
 * Branches gathered by the name they share, so a namespace reads as one thing.
 *
 * A repository whose work is cut as `dev/80gd2z`, `dev/63hhat`, `dev/0km4wk`
 * draws a dozen lines that all say the same word before they say anything else,
 * and every one of them crosses the whole band to get to its own row. So the
 * lines that share a start are run through one point on the way out: a mark
 * smaller than any commit, standing between the history and the branch column,
 * which the group leaves as one line and fans out of.
 *
 * The room it takes is bounded on purpose. Everything past the branch column —
 * the rings, and the terminals running in them — stands where the layout put
 * it, and a namespace that pushed those along would move a repository's whole
 * right-hand side. So the junctions take whole columns of the grid, and how
 * many they may take is set by how many of them there are: one column while
 * there are two of them or fewer, and one more for every two after that. What
 * a column buys is a level of nesting — `dev/` in the first, `dev/api/` in the
 * second — so a repository with a handful of namespaces gathers them at their
 * first word and one that is full of them may gather them deeper.
 */

import type { PlacedRef } from "./branches";

/** One gathering point: the shared start of the names that run through it. */
export type Junction = {
  id: string;
  /** The name it stands for, without its trailing slash: `dev`, `dev/api`. */
  prefix: string;
  /** How deep the prefix is, which is the column it stands in. Zero-based. */
  column: number;
  /** The junction it hangs off, or null where it hangs off the history. */
  parent: string | null;
  /** How many branch rows are gathered under it, the nested ones included. */
  members: number;
  /**
   * Shut: pressed so that nothing fans out of it.
   *
   * The knot stays, with the count and the lines from the history it gathers,
   * and the branches under it leave the column — a namespace of forty lines of
   * old work is a namespace somebody wants to read as one word. What is
   * running is the exception, as it is everywhere on this canvas: a branch
   * with a terminal in it is drawn whatever was pressed, hanging off the shut
   * knot, because a mark that answers to something cannot be left off.
   */
  closed: boolean;
};

/** Every junction one repository draws, and what hangs off each of them. */
export type Bundle = {
  /** Shallowest first, so a parent is always placed before its children. */
  junctions: Junction[];
  /**
   * The junction a ref's own line leaves, by ref id; absent where none does.
   *
   * Every ref, drawn or not: a ref under a shut knot still names the knot, so
   * that the lines from the history into that knot can be read off the whole
   * of what it gathers.
   */
  parentOf: ReadonlyMap<string, string>;
  /** How many columns of the grid the whole of it takes; zero when it is empty. */
  width: number;
  /** The refs that leave the column, by id: under a shut knot and not running. */
  hidden: ReadonlySet<string>;
};

/** Which knots are shut, and what keeps a branch under one drawn anyway. */
export type Shutting = {
  /** The junctions that were pressed shut, by node id. */
  closed: ReadonlySet<string>;
  /** Whether a branch is being worked in, which keeps it drawn. */
  running: (ref: PlacedRef) => boolean;
};

const EMPTY_BUNDLE: Bundle = {
  junctions: [],
  parentOf: new Map(),
  width: 0,
  hidden: new Set(),
};

const NOTHING_SHUT: Shutting = { closed: new Set(), running: () => false };

/**
 * How many junctions buy one more column.
 *
 * Two, so the first pair is gathered at their first word and every pair after
 * that is allowed one word deeper. A repository with three namespaces has
 * enough going on that `dev/api` and `dev/web` are worth telling apart; one
 * with two does not.
 */
const PER_COLUMN = 2;

/**
 * The junctions a column of branches comes to.
 *
 * Read off the logical name — the one without the remote in front of it — so
 * that a branch and its remote end are one member of a group rather than two,
 * and so that `origin` is never itself a namespace: what a remote calls a
 * branch is not what the branch is.
 */
export function bundleBranches(
  repositoryId: string,
  refs: readonly PlacedRef[],
  shutting: Shutting = NOTHING_SHUT,
): Bundle {
  // Which rows each shared start covers. Rows rather than refs: a branch and
  // its remote end share a row and are one line of work, and a group of one is
  // not a group.
  const rows = new Map<string, Set<number>>();
  for (const ref of refs) {
    for (const prefix of prefixesOf(ref.group)) {
      const held = rows.get(prefix);
      if (held) held.add(ref.row);
      else rows.set(prefix, new Set([ref.row]));
    }
  }

  const gathering = [...rows].filter(([, held]) => held.size > 1).map(([prefix]) => prefix);

  // How many of them there are is what buys the room, and the room is then what
  // says how deep they may go: a namespace past the last column gathers at its
  // own first word instead, which is always there — anything with two branches
  // under `dev/api` has two under `dev` as well.
  const columns = Math.max(1, Math.ceil(gathering.length / PER_COLUMN));
  // And then the ones that gather a single thing go, which can only happen
  // once the depth is settled: `dev` is worth drawing when `dev/api` is too
  // deep to draw and worth nothing when it is not.
  const gathered = pruned(new Set(gathering.filter((prefix) => depthOf(prefix) <= columns)), refs);
  if (gathered.size === 0) return EMPTY_BUNDLE;

  // The room is settled before anything is shut, and against the whole of
  // what is gathered: a knot that is pressed keeps its column, so that pressing
  // one does not move the branch column of everything else in the band.
  const width = [...gathered].reduce((deepest, prefix) => Math.max(deepest, depthOf(prefix)), 0);

  // A shut knot hides everything under it, the knots gathered at it included:
  // `dev/api` is inside the fan `dev` no longer draws. What is left is what is
  // drawn, and the nearest of those is what every ref under it hangs off.
  const shut = new Set(
    [...gathered].filter((prefix) => shutting.closed.has(junctionId(repositoryId, prefix))),
  );
  const kept = new Set([...gathered].filter((prefix) => holder(shut, prefix) === null));

  // By row rather than by ref: a branch and its remote end are one line of
  // work, and the end that is being worked in keeps the other drawn beside it.
  const working = new Set(refs.filter((ref) => shutting.running(ref)).map((ref) => ref.row));

  const parentOf = new Map<string, string>();
  const members = new Map<string, number>();
  const hidden = new Set<string>();
  for (const ref of refs) {
    const over = holder(kept, ref.group);
    if (over === null) continue;
    parentOf.set(ref.id, junctionId(repositoryId, over));
    if (shut.has(over) && !working.has(ref.row)) hidden.add(ref.id);
    // Every junction on the way up counts the row, so a junction says how much
    // of the column runs through it rather than how much stops there.
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

/** The branch column as it is drawn, once the shut knots have taken their rows. */
export type Column = {
  /** The refs that are drawn, each on the row it is drawn in. */
  refs: PlacedRef[];
  /** How many rows the column has. */
  rows: number;
  /** The row a shut knot with nothing left under it stands in, by junction id. */
  seats: ReadonlyMap<string, number>;
};

/**
 * The column dealt again with the shut knots' branches gone.
 *
 * The rows close up, in the order they were dealt in, so a namespace shut in
 * the middle of the column leaves no gap. A shut knot with nothing drawn under
 * it takes a row of its own, where its first branch stood: it is what the
 * namespace amounts to now, and a knot standing in the column's own rhythm
 * reads as the one line the group has become rather than as a mark that lost
 * its fan. One that still has a running branch hanging off it takes none — it
 * stands in the middle of what it covers, as an open knot does.
 */
export function dealColumn(refs: readonly PlacedRef[], bundle: Bundle): Column {
  // Which shut knots still have a branch drawn under them.
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

/** Every start of a name that could gather it: `dev/api/x` gives `dev`,
 *  `dev/api`. The whole name is not one of them — a branch does not gather
 *  itself. */
function prefixesOf(name: string): string[] {
  const parts = name.split("/");
  const prefixes: string[] = [];
  for (let cut = 1; cut < parts.length; cut++) prefixes.push(parts.slice(0, cut).join("/"));
  return prefixes;
}

function depthOf(prefix: string): number {
  return prefix.split("/").length;
}

/** The deepest of `kept` that this name starts with, or null where none does. */
function holder(kept: ReadonlySet<string>, name: string): string | null {
  let found: string | null = null;
  for (const prefix of prefixesOf(name)) {
    if (kept.has(prefix)) found = prefix;
  }
  return found;
}

/** The junction one junction hangs off: the deepest kept start of its own name. */
function above(kept: ReadonlySet<string>, prefix: string, repositoryId: string): string | null {
  const over = holder(kept, prefix);
  return over === null ? null : junctionId(repositoryId, over);
}

/**
 * Junctions that gather one thing, dropped.
 *
 * `dev/api/x` and `dev/api/y` make `dev` and `dev/api` both look like groups,
 * and the first of them has nothing to gather: everything under it goes on to
 * the same place. So a junction is kept only where at least two things hang off
 * it directly — another junction, or a row of the branch column — and dropping
 * one can leave its own parent gathering a single thing, which is why this runs
 * until nothing more falls out.
 */
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
      // By row, so a branch and its remote end are the one thing hanging there.
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

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
};

/** Every junction one repository draws, and what hangs off each of them. */
export type Bundle = {
  /** Shallowest first, so a parent is always placed before its children. */
  junctions: Junction[];
  /** The junction a ref's own line leaves, by ref id; absent where none does. */
  parentOf: ReadonlyMap<string, string>;
  /** How many columns of the grid the whole of it takes; zero when it is empty. */
  width: number;
};

const EMPTY_BUNDLE: Bundle = { junctions: [], parentOf: new Map(), width: 0 };

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
export function bundleBranches(repositoryId: string, refs: readonly PlacedRef[]): Bundle {
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
  const kept = pruned(new Set(gathering.filter((prefix) => depthOf(prefix) <= columns)), refs);
  if (kept.size === 0) return EMPTY_BUNDLE;

  const parentOf = new Map<string, string>();
  const members = new Map<string, number>();
  for (const ref of refs) {
    const over = holder(kept, ref.group);
    if (over === null) continue;
    parentOf.set(ref.id, junctionId(repositoryId, over));
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
    }));

  return {
    junctions,
    parentOf,
    width: junctions.reduce((deepest, junction) => Math.max(deepest, junction.column + 1), 0),
  };
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

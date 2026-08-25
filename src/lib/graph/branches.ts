import type { Branch, Repository } from "../../types/git";
import { groupBy } from "../collections";
import type { Placed } from "./history";
import type { BranchHeadData, Fetch } from "./model";

/**
 * The branch half of a band: a column of names, read downwards.
 *
 * Every branch stands in one column, dealt into its own grid row in logical-name
 * order. Its edge can therefore fork from a commit just like another commit
 * edge; several names pointing at one commit never share a label track. Only a
 * synchronized local/remote pair shares one row and grid point.
 */

/** A branch head, and the row of the column it was dealt. */
export type PlacedRef = {
  id: string;
  data: BranchHeadData;
  /** The commit it points at, as a position in the history's own order. */
  from: number;
  /** Its row, counted from the top of the column. */
  row: number;
  /** What this branch is to the repository, set after its name; see `noteOf`. */
  note: string | null;
};

/** Every branch pointing into the history that is drawn, in a column. */
export function placeBranches(
  repository: Repository,
  placed: readonly Placed[],
): { refs: PlacedRef[]; rows: number } {
  const pairs = pairsOf(repository);

  // A branch pointing into history that is not shown is not shown either:
  // folding a stretch of history away means folding away what is on it — the
  // branches, their worktrees and whatever they were running. The collapse node
  // says how much went, and expanding brings all of it back.
  const found: { ref: Ref; from: number }[] = [];
  for (const [position, entry] of placed.entries()) {
    // Asked of the entry before anything is built for it: this runs once per
    // commit, and all but a handful of them have no name on them at all.
    if (entry.branches.length === 0 && entry.worktrees.length === 0) continue;
    for (const ref of refsOf(entry, pairs)) found.push({ ref, from: position });
  }
  found.sort((left, right) => inOrder(left.ref, right.ref));

  const taken = new Map<string, number>();
  const refs = found.map(({ ref, from }) => {
    const held = taken.get(ref.shared);
    const row = held ?? taken.size;
    if (held === undefined) taken.set(ref.shared, row);

    return {
      id: `${repository.id}ref${ref.key}`,
      data: {
        repository,
        kind: ref.kind,
        name: ref.name,
        hasRemote: ref.hasRemote,
        together: ref.together,
        fetch: ref.fetch,
        cwd: ref.cwd,
      },
      from,
      row,
      note: noteOf(ref, repository.defaultBranch),
    };
  });

  return { refs, rows: taken.size };
}

/** Where two names are drawn: first by the branch name without its remote
 *  namespace, then with remote ends before the local end. Thus `main`,
 *  `origin/main`, and `upstream/main` stay next to one another regardless of
 *  what their remotes happen to be called. Remote comes first only so its
 *  larger ring sits behind the local control when both share a point. */
function inOrder(left: Ref, right: Ref): number {
  return (
    byName(left.group, right.group) ||
    Number(right.kind === "remote") - Number(left.kind === "remote") ||
    byName(left.name, right.name)
  );
}

/**
 * Names in the order git itself puts them in, which is the order the backend
 * hands the branches over in.
 */
function byName(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

/**
 * What a branch is to the repository, set after its name in brackets: the one it
 * is standing on, and the one it treats as its default. Nearly every branch is
 * neither and is left as its name alone, because a bracket on everything is a
 * bracket on nothing. A branch that is both reads as one bracket saying both.
 *
 * `fallback` is the default as git reports it — a full ref name, so it matches
 * `refName` rather than the shortened name that is drawn.
 */
function noteOf(ref: Ref, fallback: string | null): string | null {
  const notes: string[] = [];
  if (ref.head) notes.push("Head");
  if (fallback !== null && ref.refName === fallback) notes.push("default");
  return notes.length > 0 ? notes.join(", ") : null;
}

/** A branch or worktree name, and what can be done where it points. */
type Ref = ReturnType<typeof refsOf>[number];

/** The other end of one branch, and what both ends need to know about it. */
type Pairing = {
  /** The branch at the other end. */
  other: Branch;
  /** The remote that end stands on. */
  remote: string;
  /** Both ends stand on one commit, which is a branch at rest. */
  together: boolean;
  /** The local end's worktree, whichever end is asking. */
  work: string | null;
};

/**
 * Which branches are two ends of one branch, paired by name — the same guess
 * `git switch` makes, except read afresh every time rather than written into the
 * config once. Where one name is on several remotes the branch's own upstream
 * settles it, and failing that the first remote the repository lists.
 */
function pairsOf(repository: Repository): Map<string, Pairing> {
  const order = new Map(repository.remotes.map((remote, at) => [remote.name, at]));
  const rank = (branch: Branch) => order.get(branch.remote ?? "") ?? order.size;
  const ends = groupBy(
    repository.branches.filter((branch) => branch.kind === "remote"),
    (branch) => branch.logicalName,
  );
  const paths = new Map(repository.worktrees.map((worktree) => [worktree.id, worktree.path]));

  const pairs = new Map<string, Pairing>();
  for (const local of repository.branches) {
    if (local.kind !== "local") continue;
    const candidates = ends.get(local.logicalName);
    if (candidates === undefined) continue;

    const remote =
      candidates.find((end) => end.refName === local.upstream) ??
      candidates.reduce((best, end) => (rank(end) < rank(best) ? end : best));
    // A remote-tracking ref under no remote this repository has is a ref
    // somebody left behind, not an end of anything.
    const on = remote.remote;
    if (on === null) continue;

    const work =
      local.checkedOutIn.map((id) => paths.get(id)).find((path) => path !== undefined) ?? null;
    const together = remote.commit === local.commit;

    pairs.set(local.id, { other: remote, remote: on, together, work });
    pairs.set(remote.id, { other: local, remote: on, together, work });
  }

  return pairs;
}

/** What a head can ask a remote for. The end standing on the remote asks,
 *  because that is the ref a fetch moves. Local and remote heads are always
 *  separate nodes, even when the canvas puts them at the same point. */
function fetchOf(branch: Branch, pair: Pairing | undefined): Fetch | null {
  if (branch.kind === "remote") {
    return branch.remote === null
      ? null
      : { remote: branch.remote, branch: branch.logicalName, work: pair?.work ?? null };
  }
  return null;
}

/** The names pointing at one commit. A branch is checked out in at most one
 *  worktree, so only a detached one is named after itself. */
function refsOf(entry: Placed, pairs: ReadonlyMap<string, Pairing>) {
  const named = new Set<string>();

  const branches = entry.branches.flatMap((branch) => {
    const checkout = entry.worktrees.find((worktree) => branch.checkedOutIn.includes(worktree.id));
    for (const worktree of entry.worktrees) {
      if (branch.checkedOutIn.includes(worktree.id)) named.add(worktree.id);
    }

    const pair = pairs.get(branch.id);
    const remote = branch.kind === "remote";
    return [
      {
        key: branch.id,
        name: branch.name,
        /** How the backend spells it, which is what `defaultBranch` names. */
        refName: branch.refName,
        kind: remote ? ("remote" as const) : ("local" as const),
        /** Only synchronized counterparts may occupy one branch lane. */
        shared: pair?.together === true ? [branch.id, pair.other.id].sort().join("+") : branch.id,
        /** Remote namespaces never affect order: all forms of `main` group. */
        group: branch.logicalName,
        // A local branch and its remote-tracking counterpart are separate refs,
        // but the local ring still says when the branch also exists elsewhere.
        hasRemote: remote || pair !== undefined,
        together: pair?.together === true,
        fetch: fetchOf(branch, pair),
        head: branch.isHead,
        cwd: checkout?.path ?? null,
      },
    ];
  });

  const detached = entry.worktrees
    .filter((worktree) => !named.has(worktree.id))
    .map((worktree) => ({
      key: worktree.id,
      name: worktree.name,
      refName: null,
      kind: "worktree" as const,
      shared: worktree.id,
      group: worktree.name,
      hasRemote: false,
      together: false,
      fetch: null,
      head: false,
      cwd: worktree.path,
    }));

  return [...branches, ...detached];
}

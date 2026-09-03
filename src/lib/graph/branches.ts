import type { Branch, Repository, Worktree } from "../../types/git";
import { groupBy } from "../collections";
import type { Placed } from "./history";
import { graphIgnore } from "./ignore";
import type { BranchHeadData, Fetch, Origin } from "./model";

/**
 * The branch half of a band: a column of names, read downwards.
 *
 * Every branch stands in one column, dealt into its own grid row in logical-name
 * order. Its edge can therefore fork from a commit just like another commit
 * edge; several names pointing at one commit never share a label track. Only a
 * synchronized local/remote pair shares one row and grid point.
 *
 * Every branch the repository has, and not only the ones standing on the
 * commits that fit on screen. A graph opens folded, so a branch cut a fortnight
 * ago points behind the fold — and drawing a repository as though it had three
 * branches because it is showing three commits was the graph hiding the very
 * thing it is for. What is behind the fold hangs off the fold, which is the
 * mark that stands for it. Which names are not worth a row is the repository's
 * own to say: see `ignore`.
 */

/** A branch head, and the row of the column it was dealt. */
export type PlacedRef = {
  id: string;
  data: BranchHeadData;
  /**
   * The commit it points at, as a position in the history's own order, or null
   * where that commit is behind the fold.
   */
  from: number | null;
  /** Its row, counted from the top of the column. */
  row: number;
  /** The name this ref is gathered by, which is its name without the remote. */
  group: string;
  /** What this branch is to the repository, set above its name; see `noteOf`. */
  note: string | null;
};

/** What a band knows about itself that decides which refs it draws. */
export type Shown = {
  /** Whether there is a fold to hang the branches behind it off. */
  folded: boolean;
  /** Whether anything is running in a directory, which keeps its branch drawn
   *  however the repository's own list reads. */
  running: (cwd: string | null) => boolean;
};

/** Every branch the repository has, in a column. */
export function placeBranches(
  repository: Repository,
  placed: readonly Placed[],
  shown: Shown,
): { refs: PlacedRef[]; rows: number } {
  const pairs = pairsOf(repository);
  const hidden = graphIgnore(repository.graphIgnore);
  // Where each commit that is drawn stands, so a name can be asked whether the
  // history under it is on screen.
  const at = new Map(placed.map((entry, position) => [entry.commit.id, position]));

  const found: { ref: Ref; from: number | null }[] = [];
  for (const [commit, entry] of namedCommits(repository)) {
    const from = at.get(commit) ?? null;
    // A branch behind the fold hangs off the fold. Where there is none — a
    // repository showing the whole of what it handed over — a name pointing
    // outside it is a name pointing at history nothing on this canvas draws,
    // and there is nowhere to run its line from.
    if (from === null && !shown.folded) continue;

    for (const ref of refsOf(entry, pairs)) {
      // A branch somebody is working in is drawn whatever the list says: the
      // graph is where a running terminal is found, and a mark that answers to
      // something cannot be left off it.
      if (hidden(ref.name, ref.group) && !shown.running(ref.cwd)) continue;
      found.push({ ref, from });
    }
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
        origin: ref.origin,
        cwd: ref.cwd,
      },
      from,
      row,
      group: ref.group,
      note: noteOf(ref, repository.defaultBranch),
    };
  });

  return { refs, rows: taken.size };
}

/** The names standing on one commit, whether or not that commit is drawn. */
type Named = { branches: readonly Branch[]; worktrees: readonly Worktree[] };

/**
 * Every commit any name points at, with the names on it.
 *
 * The whole repository rather than the slice on screen: what is behind the fold
 * still has branches, and they are drawn off the fold. A worktree with no head
 * is bucketed under a key no commit can have, which leaves it out — there is no
 * commit for its line to come from.
 */
function namedCommits(repository: Repository): Map<string, Named> {
  const branchesAt = groupBy(repository.branches, (branch) => branch.commit);
  const worktreesAt = groupBy(repository.worktrees, (worktree) => worktree.head ?? "");

  const named = new Map<string, Named>();
  for (const commit of [...branchesAt.keys(), ...worktreesAt.keys()]) {
    if (commit === "" || named.has(commit)) continue;
    named.set(commit, {
      branches: branchesAt.get(commit) ?? [],
      worktrees: worktreesAt.get(commit) ?? [],
    });
  }
  return named;
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
 * What a branch is to the repository, set on a line above its name: the one it
 * is standing on, and the one it treats as its default. Nearly every branch is
 * neither and is left as its name alone, because a note on everything is a note
 * on nothing. A branch that is both reads as one line saying both.
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

/** The remote end a local branch can be laid over, which is the whole of what
 *  the pairing is worth to the local end. Only where the two have parted: two
 *  ends drawn on one grid point are already level, and a mark cannot be laid
 *  over the one it is standing on — the fetch on the remote ring is what asks
 *  whether they still are. */
function originOf(branch: Branch, pair: Pairing | undefined): Origin | null {
  if (branch.kind !== "local" || pair === undefined || pair.together) return null;
  return { head: pair.other.name, remote: pair.remote, branch: branch.logicalName };
}

/** The names pointing at one commit. A branch is checked out in at most one
 *  worktree, so only a detached one is named after itself. */
function refsOf(entry: Named, pairs: ReadonlyMap<string, Pairing>) {
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
        origin: originOf(branch, pair),
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
      origin: null,
      head: false,
      cwd: worktree.path,
    }));

  return [...branches, ...detached];
}

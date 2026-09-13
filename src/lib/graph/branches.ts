import type { Branch, Repository, Worktree } from "../../types/git";
import { groupBy } from "../collections";
import type { Placed } from "./history";
import { graphIgnore } from "./ignore";
import type { BranchHeadData, Fetch, Origin } from "./model";

// Every branch of the repository is dealt a row, not only those on visible
// commits: what points behind the fold hangs off the fold.

export type PlacedRef = {
  id: string;
  data: BranchHeadData;
  /** Position in the history's order, or null when the commit is behind the fold. */
  from: number | null;
  row: number;
  /** The name without its remote, which the column is sorted and gathered by. */
  group: string;
  note: string | null;
};

export type Shown = {
  folded: boolean;
  /** A branch something is running in is drawn whatever the ignore list says. */
  running: (cwd: string | null) => boolean;
};

export function placeBranches(
  repository: Repository,
  placed: readonly Placed[],
  shown: Shown,
): { refs: PlacedRef[]; rows: number } {
  const pairs = pairsOf(repository);
  const hidden = graphIgnore(repository.graphIgnore);
  const at = new Map(placed.map((entry, position) => [entry.commit.id, position]));

  const found: { ref: Ref; from: number | null }[] = [];
  for (const [commit, entry] of namedCommits(repository)) {
    const from = at.get(commit) ?? null;
    // Without a fold there is nowhere to run the line of an off-canvas commit from.
    if (from === null && !shown.folded) continue;

    for (const ref of refsOf(entry, pairs)) {
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

type Named = { branches: readonly Branch[]; worktrees: readonly Worktree[] };

// A worktree with no head is bucketed under "" and left out: no commit to draw from.
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

// Remote first only so its larger ring sits behind the local control on a shared point.
function inOrder(left: Ref, right: Ref): number {
  return (
    byName(left.group, right.group) ||
    Number(right.kind === "remote") - Number(left.kind === "remote") ||
    byName(left.name, right.name)
  );
}

function byName(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

// `fallback` is a full ref name, so it is matched against `refName`.
function noteOf(ref: Ref, fallback: string | null): string | null {
  const notes: string[] = [];
  if (ref.head) notes.push("Head");
  if (fallback !== null && ref.refName === fallback) notes.push("default");
  return notes.length > 0 ? notes.join(", ") : null;
}

type Ref = ReturnType<typeof refsOf>[number];

type Pairing = {
  other: Branch;
  remote: string;
  /** Both ends on one commit. */
  together: boolean;
  /** The local end's worktree, whichever end is asking. */
  work: string | null;
};

// Local and remote ends are paired by name, the guess `git switch` makes; the
// upstream settles a name on several remotes, else the first remote listed.
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
    // A remote-tracking ref under no known remote is a leftover, not an end.
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

// Only the remote end fetches: that is the ref a fetch moves.
function fetchOf(branch: Branch, pair: Pairing | undefined): Fetch | null {
  if (branch.kind === "remote") {
    return branch.remote === null
      ? null
      : { remote: branch.remote, branch: branch.logicalName, work: pair?.work ?? null };
  }
  return null;
}

// Only a local end that has parted from its remote can be laid over it.
function originOf(branch: Branch, pair: Pairing | undefined): Origin | null {
  if (branch.kind !== "local" || pair === undefined || pair.together) return null;
  return { head: pair.other.name, remote: pair.remote, branch: branch.logicalName };
}

// A branch is checked out in at most one worktree; only a detached one is named after itself.
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
        refName: branch.refName,
        kind: remote ? ("remote" as const) : ("local" as const),
        // Only synchronized counterparts share one lane.
        shared: pair?.together === true ? [branch.id, pair.other.id].sort().join("+") : branch.id,
        group: branch.logicalName,
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

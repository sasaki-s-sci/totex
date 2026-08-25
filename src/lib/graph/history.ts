import type { Branch, Commit, Repository, Worktree } from "../../types/git";
import { groupBy } from "../collections";
import { DEFAULT_VISIBLE_COMMITS } from "./model";

/**
 * The history half of a band: which cell of the grid every commit is drawn in.
 *
 * Two numbers per commit. The column is how far along the history it is — one
 * past the last of its parents, so parallel work is drawn in parallel — and the
 * row is the lane the packing gave it, with the trunk holding the top one. Both
 * in cells rather than pixels: what a cell is worth is `layout`'s business, and
 * where a branch's *name* goes is `branches`'.
 */

/** One commit, and the cell it was dealt. */
export type Placed = {
  commit: Commit;
  /** The lane it runs in: zero is the trunk's, at the top of the band. */
  row: number;
  branches: Branch[];
  worktrees: Worktree[];
  /** At least one parent is outside the history handed over, so the line really
   *  does end here. History merely folded away has its own dash. */
  boundary: boolean;
  /** At least one parent is known and merely folded away, and the collapse
   *  node's own dash does not already run there. Without this the gap where one
   *  run ends and the next begins reads as a line that failed to draw. */
  folded: boolean;
};

/** A repository's history, dealt out on the grid. */
export type History = {
  placed: Placed[];
  /** Where each commit is in `placed`, by sha, for following a line to a parent. */
  index: Map<string, number>;
  /** The column each commit stands in, in `placed`'s own order. */
  columns: number[];
  /** How many columns the whole of it takes, the fold's own included. */
  width: number;
  /** And how many rows: one per lane the packing had to open. */
  depth: number;
  /** How many commits are behind the fold; zero when the whole history is drawn. */
  hidden: number;
};

export function commitNodeId(repository: Repository, sha: string): string {
  return `${repository.id}commit${sha}`;
}

/** How many commits to show when nobody has asked for more: always enough to
 *  reach the tip of the line the repository is on. */
export function defaultShown(repository: Repository): number {
  const trunk = trunkOf(repository)?.commit;
  const count = Math.min(DEFAULT_VISIBLE_COMMITS, repository.commits.length);
  if (trunk === undefined) return count;
  const at = repository.commits.findIndex((commit) => commit.id === trunk);
  return at === -1 ? count : Math.max(count, at + 1);
}

/** The branch the repository is on, which the top lane is held for. A detached
 *  or bare repository falls back to git's own default branch. */
export function trunkOf(repository: Repository): Branch | undefined {
  return (
    repository.branches.find((branch) => branch.isHead) ??
    repository.branches.find((branch) => branch.refName === repository.defaultBranch)
  );
}

/** The newest `shown` commits, sorted into lanes and columns. */
export function placeHistory(repository: Repository, shown: number): History {
  const branchesAt = groupBy(repository.branches, (branch) => branch.commit);
  // A worktree with no head is bucketed under a key no commit can have, which
  // is the same as leaving it out.
  const worktreesAt = groupBy(repository.worktrees, (worktree) => worktree.head ?? "");

  // The newest slice of history. What falls outside is not lost: it is behind
  // the collapse node, and the branches that pointed into it hang off that
  // instead.
  const commits = repository.commits.slice(0, shown);
  const hidden = repository.commits.length - shown;

  // Two different questions, and answering both with one set is what put a stub
  // of "the history ends here" on a commit whose parent was merely folded away.
  // `drawn` is what this graph has room for, and settles where the lines can
  // run; `known` is everything the repository handed over, and settles whether
  // there is any more history at all.
  const drawn = new Set(commits.map((commit) => commit.id));
  const known = new Set(repository.commits.map((commit) => commit.id));

  const rows = assignLanes(commits, drawn, trunkOf(repository)?.commit);
  // The one commit the collapse node's own dash already runs to, which is
  // therefore the one that needs no dash of its own.
  const oldest = commits.length - 1;

  const placed: Placed[] = commits.map((commit, position) => ({
    commit,
    row: rows[position],
    branches: branchesAt.get(commit.id) ?? [],
    worktrees: worktreesAt.get(commit.id) ?? [],
    boundary: commit.parents.some((parent) => !known.has(parent)),
    folded:
      position !== oldest &&
      commit.parents.some((parent) => known.has(parent) && !drawn.has(parent)),
  }));

  const index = new Map(placed.map((entry, position) => [entry.commit.id, position]));
  const { columns, count } = assignColumns(placed, index, rows);

  // The fold takes the column before the history, so the dash out of it runs
  // the length of a column like any other piece of history.
  const shift = hidden > 0 ? 1 : 0;

  let depth = 0;
  for (const row of rows) depth = Math.max(depth, row + 1);

  return {
    placed,
    index,
    columns: columns.map((column) => column + shift),
    width: count + shift,
    depth,
    hidden,
  };
}

/**
 * Where along the history each commit sits: the column after the last of its
 * parents, which is what makes the picture a graph rather than a list. `git
 * log`'s own order cannot do this — it hands a branch's commits back in one run,
 * so the branch would begin wherever that run falls instead of at the fork.
 *
 * `next` holds the first column each row is still free in, so a row never has
 * two commits in one column. The gaps that do appear are the history's own.
 */
function assignColumns(placed: Placed[], index: Map<string, number>, rows: number[]) {
  const columns = new Array<number>(placed.length);
  const next = new Map<number, number>();
  let count = 0;

  // Oldest first — the order the history arrives in, reversed — so every parent
  // that was loaded already has its column by the time its children ask for it.
  for (let position = placed.length - 1; position >= 0; position--) {
    const entry = placed[position];
    let column = next.get(rows[position]) ?? 0;

    for (const parent of entry.commit.parents) {
      const at = index.get(parent);
      // A parent from beyond the loaded history says nothing about where this
      // commit belongs; its lane is then all there is to go on. One that has
      // not been placed yet means the history did not arrive oldest-last, which
      // `--topo-order` promises — reading its column then would be reading a
      // hole, and one `NaN` here takes the whole canvas down with it.
      if (at === undefined || at < position) continue;
      column = Math.max(column, columns[at] + 1);
    }

    columns[position] = column;
    next.set(rows[position], column + 1);
    count = Math.max(count, column + 1);
  }

  return { columns, count };
}

/**
 * Classic lane packing, walking newest to oldest: a commit takes the lane its
 * children reserved, its first parent inherits it, and every other parent opens
 * one of its own. Lanes are released as soon as the commit holding them is
 * drawn, so one lane carries a run of unrelated lines over a long history.
 *
 * Lane zero is held for `trunk`, the tip of the branch the repository is on, so
 * the line the work is happening on runs across the top of the band.
 */
function assignLanes(commits: Commit[], drawn: Set<string>, trunk: string | undefined): number[] {
  const reserved: (string | null)[] = trunk !== undefined && drawn.has(trunk) ? [trunk] : [];
  const lanes: number[] = [];

  const claim = () => {
    const free = reserved.indexOf(null);
    if (free !== -1) return free;
    reserved.push(null);
    return reserved.length - 1;
  };

  const waiting: number[] = [];
  for (const commit of commits) {
    // Indexed rather than `entries()`: this runs once per lane per commit, and
    // at five thousand commits the tuples it would allocate are the bulk of
    // what laying a repository out costs.
    waiting.length = 0;
    for (let lane = 0; lane < reserved.length; lane++) {
      if (reserved[lane] === commit.id) waiting.push(lane);
    }

    const lane = waiting.length > 0 ? waiting[0] : claim();
    // Several children can converge here; all but one of their lanes end.
    for (const other of waiting) reserved[other] = null;
    reserved[lane] = null;

    lanes.push(lane);

    for (const [parentIndex, parent] of commit.parents.entries()) {
      if (!drawn.has(parent)) continue;
      // The first parent carries on this commit's own lane even when another
      // line is already waiting for it. The parent then has two lanes waiting,
      // takes the lower of them, and the other ends there — which is what keeps
      // a long-lived line whole instead of handing it to the first branch that
      // happened to be cut from it.
      if (parentIndex === 0 && reserved[lane] === null) {
        reserved[lane] = parent;
        continue;
      }
      if (reserved.includes(parent)) continue;
      reserved[claim()] = parent;
    }
  }

  return lanes;
}

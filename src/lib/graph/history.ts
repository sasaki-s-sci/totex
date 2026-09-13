import type { Branch, Commit, Repository, Worktree } from "../../types/git";
import { groupBy } from "../collections";
import { DEFAULT_VISIBLE_COMMITS } from "./model";

// Columns and rows are in cells; `layout` decides what a cell is worth.

export type Placed = {
  commit: Commit;
  /** Zero is the trunk's lane, at the top of the band. */
  row: number;
  branches: Branch[];
  worktrees: Worktree[];
  /** A parent is outside the history handed over: the line really ends here. */
  boundary: boolean;
  /** A parent is known but folded away, and the fold's own dash does not reach here. */
  folded: boolean;
};

export type History = {
  placed: Placed[];
  index: Map<string, number>;
  columns: number[];
  /** Columns taken, the fold's own included. */
  width: number;
  depth: number;
  hidden: number;
};

export function commitNodeId(repository: Repository, sha: string): string {
  return `${repository.id}commit${sha}`;
}

/** Always enough to reach the tip of the branch the repository is on. */
export function defaultShown(repository: Repository): number {
  const trunk = trunkOf(repository)?.commit;
  const count = Math.min(DEFAULT_VISIBLE_COMMITS, repository.commits.length);
  if (trunk === undefined) return count;
  const at = repository.commits.findIndex((commit) => commit.id === trunk);
  return at === -1 ? count : Math.max(count, at + 1);
}

// Settled here rather than in the layout, so the cache key is the depth actually drawn.
export function depthOf(repository: Repository, want: number | undefined): number {
  return Math.max(1, Math.min(repository.commits.length, want ?? defaultShown(repository)));
}

export function trunkOf(repository: Repository): Branch | undefined {
  return (
    repository.branches.find((branch) => branch.isHead) ??
    repository.branches.find((branch) => branch.refName === repository.defaultBranch)
  );
}

export function placeHistory(repository: Repository, shown: number): History {
  const branchesAt = groupBy(repository.branches, (branch) => branch.commit);
  const worktreesAt = groupBy(repository.worktrees, (worktree) => worktree.head ?? "");

  const commits = repository.commits.slice(0, shown);
  const hidden = repository.commits.length - shown;

  // `drawn` settles where lines can run; `known` settles whether more history exists.
  const drawn = new Set(commits.map((commit) => commit.id));
  const known = new Set(repository.commits.map((commit) => commit.id));

  const rows = assignLanes(commits, drawn, trunkOf(repository)?.commit);
  // The fold's own dash already reaches the oldest commit.
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

// A commit sits one column past the last of its parents, which `git log`'s
// order alone cannot give.
function assignColumns(placed: Placed[], index: Map<string, number>, rows: number[]) {
  const columns = new Array<number>(placed.length);
  const next = new Map<number, number>();
  let count = 0;

  for (let position = placed.length - 1; position >= 0; position--) {
    const entry = placed[position];
    let column = next.get(rows[position]) ?? 0;

    for (const parent of entry.commit.parents) {
      const at = index.get(parent);
      // `at < position` means the history did not arrive oldest-last as
      // `--topo-order` promises; reading that column would be NaN.
      if (at === undefined || at < position) continue;
      column = Math.max(column, columns[at] + 1);
    }

    columns[position] = column;
    next.set(rows[position], column + 1);
    count = Math.max(count, column + 1);
  }

  return { columns, count };
}

// Classic lane packing newest to oldest; lane zero is held for the trunk.
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
    // Indexed loop: `entries()` tuples were the bulk of the cost at 5k commits.
    waiting.length = 0;
    for (let lane = 0; lane < reserved.length; lane++) {
      if (reserved[lane] === commit.id) waiting.push(lane);
    }

    const lane = waiting.length > 0 ? waiting[0] : claim();
    for (const other of waiting) reserved[other] = null;
    reserved[lane] = null;

    lanes.push(lane);

    for (const [parentIndex, parent] of commit.parents.entries()) {
      if (!drawn.has(parent)) continue;
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

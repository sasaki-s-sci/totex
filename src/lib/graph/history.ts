import type { Branch, Commit, Repository, Worktree } from "../../types/git";
import { groupBy } from "../collections";
import { DEFAULT_VISIBLE_COMMITS } from "./model";

/**
 * The history half of a band: which cell of the grid every commit is drawn in.
 *
 * Two numbers per commit and nothing else. The column is how far along the
 * history it is — a commit stands one past the last of its parents, so the work
 * that happened in parallel is drawn in parallel. The row is the line of
 * development it belongs to, which is the lane the packing gave it, with the
 * trunk holding the top one.
 *
 * Both are counted in cells rather than in pixels: what a cell is worth is the
 * band's business — see `layout` — and nothing here has to know it.
 *
 * Where a branch's *name* goes is a different question with a different answer:
 * the names stand in a column of their own, in the alphabet's order, so that
 * what a repository has is one thing to read rather than something to be found
 * among the commits. See `branches`.
 */

/** One commit, and the cell it was dealt. */
export type Placed = {
  commit: Commit;
  /** The lane it runs in: zero is the trunk's, at the top of the band. */
  row: number;
  branches: Branch[];
  worktrees: Worktree[];
  /**
   * At least one parent is outside the history the repository handed over, so
   * the line really does end here. History that is merely folded away is not
   * this: the fold has its own dash and its own way back.
   */
  boundary: boolean;
  /**
   * At least one parent is known and merely folded away, and the collapse
   * node's own dash does not already run there.
   *
   * A row carries whatever lines of development fit along it, so a chain cut
   * short by the fold can be followed on its own row by an unrelated one, and
   * the two marks either side of the join have nothing drawn between them.
   * Without this that gap reads as a line that failed to draw.
   */
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

/**
 * How many commits to show when nobody has asked for more.
 *
 * Always enough to reach the tip of the line the repository is on: a graph that
 * hid the commit you are sitting on would be answering the wrong question.
 */
export function defaultShown(repository: Repository): number {
  const trunk = trunkOf(repository)?.commit;
  const count = Math.min(DEFAULT_VISIBLE_COMMITS, repository.commits.length);
  if (trunk === undefined) return count;
  const at = repository.commits.findIndex((commit) => commit.id === trunk);
  return at === -1 ? count : Math.max(count, at + 1);
}

/**
 * The branch the repository is on, which the top lane is held for.
 *
 * A detached or bare repository has no branch checked out; the branch git
 * itself would call the default one is the next best trunk.
 */
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
 * Where along the history each commit sits.
 *
 * A commit takes the column after the last of its parents, which is what makes
 * the picture a graph rather than a list: a branch starts at the very commit it
 * was cut from, and the work that happened in parallel is drawn in parallel.
 * Reading the position out of `git log`'s own order cannot do this — the log
 * hands back a branch's commits in one run, so the branch would begin wherever
 * that run happens to fall instead of at the fork.
 *
 * A row never has two commits in one column: `next` holds the first column each
 * row is still free in, and no commit is placed before it. Nothing else moves a
 * commit along the axis — one column is one commit, and the gaps that do appear
 * are the history's own, a merge waiting on a branch to finish.
 *
 * Nothing but commits is placed here. The branches stand in a column of their
 * own past the whole of this, so no commit has to make room for one.
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
 * children reserved for it, its first parent inherits that lane, and every
 * other parent opens a lane of its own. Lanes are released as soon as the
 * commit that reserved them is drawn, so the tree stays shallow.
 *
 * `trunk` is the tip of the branch the repository is on. Lane zero is held for
 * it, so the line the work is happening on runs across the top of the band and
 * everything else hangs under it — rather than lane zero going to whichever tip
 * the log happened to print first, which leaves the trunk looking like a branch
 * of a branch.
 *
 * A lane is a row of the picture and nothing more. It is handed on the moment
 * the commit holding it is drawn, so one lane carries a run of unrelated lines
 * over the length of a history — a topic branch, and then whatever was cut
 * next. That is exactly what a row of a graph is for, and the dash on a commit
 * whose parent was folded away is what says where one run ends and the next
 * begins.
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

/**
 * What each kind of node carries, and the union React Flow is handed.
 */

import type { Branch, Commit, Repository, Worktree } from "../../types/git";

export type CommitNodeData = {
  commit: Commit;
  repository: Repository;
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
   * node's own dash does not already run here.
   *
   * This is the fold's dash, on the commits the fold's single line cannot
   * reach: a row carries whatever lines of development fit along it, so a chain
   * cut short by the fold can be followed on its own row by an unrelated one,
   * and the two marks either side of the join have nothing drawn between them.
   * Without this that gap reads as a line that failed to draw.
   */
  folded: boolean;
};

export type RefKind = "local" | "remote" | "worktree";

/**
 * What a head can ask a remote for.
 *
 * A branch on this machine and the same name on a remote are two refs, and git
 * keeps them apart. They are one branch to whoever works in it, so the window
 * pairs them by name — the same guess git itself makes the first time you check
 * a remote branch out, and the one a person makes reading the column. What the
 * pairing buys is a row the two ends share, and this: the end that stands on
 * the remote is a place the rest of the branch can be asked for from.
 */
export type Fetch = {
  /** The remote to ask. */
  remote: string;
  /** The name that remote knows the branch by. */
  branch: string;
  /**
   * The local end's worktree, or null where the branch has none here.
   *
   * A fetch writes refs and objects and touches no file, so it is safe at any
   * time — but it is offered only over a codebase with nothing uncommitted in
   * it, because reaching for what the remote has is something done between
   * pieces of work rather than in the middle of one.
   */
  work: string | null;
};

/**
 * The remote end of a branch, as the local end sees it.
 *
 * The counterpart of `Fetch`, carried by the other one of the pair and for the
 * other gesture. A fetch is asked for from the remote end because that is the
 * ref it moves; bringing the branch level with what came down moves the local
 * end, so it is the local end that says where its own remote end is standing.
 */
export type Origin = {
  /** The remote head's name, which is the mark the branch can be let go on. */
  head: string;
  /** The remote to ask. */
  remote: string;
  /** The name that remote knows the branch by. */
  branch: string;
};

/**
 * Where a branch or workspace is, at the end of the line from the commit its
 * ref points at.
 *
 * A branch that was cut and never committed to still has one, which is the
 * point of drawing it — the layered node says the branch exists, and the curve
 * out to it carries the name.
 *
 * A worktree is where a branch is checked out, one at most, so the branch name
 * already says which worktree it is and the folder name is left off.
 */
export type BranchHeadData = {
  repository: Repository;
  kind: RefKind;
  name: string;
  /** This ref exists on at least one remote, rather than only on this machine. */
  hasRemote: boolean;
  /**
   * The paired local and remote refs stand on the same commit. They remain two
   * nodes, but share a grid point and split their coincident edges vertically.
   */
  together: boolean;
  /** What this head can ask a remote for, and null where nothing can be asked. */
  fetch: Fetch | null;
  /**
   * The remote end this branch can be laid over, for the local end alone.
   *
   * Null on a branch this machine is the only one to have, and null on the
   * remote end itself — a remote-tracking ref is not somewhere git can merge
   * into, so it has nowhere of its own to be brought level with.
   */
  origin: Origin | null;
  /** The worktree this is checked out in, which a shell can be opened in. */
  cwd: string | null;
  /**
   * The branch is only being proposed: a pull has reached the history it
   * stands on and the hand has not let go of it yet.
   *
   * Folding a stretch of history away folds away what is on it, so a pull the
   * other way brings branches back — and until it is let go they are drawn the
   * way this canvas draws everything that is an offer rather than a fact. See
   * `useHistoryPull`.
   */
  provisional?: boolean;
};

export type RepositoryNodeData = {
  repository: Repository;
  /** Band-relative box of the name's cell, which leads the row the band opens on. */
  label: { x: number; y: number; width: number; height: number };
};

/**
 * A folder that was put on the graph: the row that heads the repositories in
 * it.
 *
 * A folder is not a repository and is drawn as one line rather than as a band
 * of history — its name, its own mark, and the one button a directory answers
 * to. What it holds stands underneath, a repository to a row, each joined back
 * to that mark.
 *
 * The row is also a place: a terminal opened here runs in the folder itself,
 * which is where work that spans the repositories happens, and anything already
 * running in there stands beside this row.
 */
export type FolderNodeData = {
  /** The directory itself, which is what a terminal here opens in. */
  root: string;
  name: string;
  /** Band-relative box of the name's cell, which leads the row. */
  label: { x: number; y: number; width: number; height: number };
  /**
   * Whether every repository in it is opened out.
   *
   * What the name does when it is pressed: a folder with anything still folded
   * opens the lot, and one that is fully open folds the lot away.
   */
  open: boolean;
  /**
   * Band-relative left edge of the folder's own mark.
   *
   * The one thing on the row that is the folder itself: every line out to a
   * repository leaves it, and it is what the hand takes the group by.
   */
  mark: number;
  /** Band-relative left edge of the row's own button. */
  tools: number;
};

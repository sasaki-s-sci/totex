/** Mirrors the serde types in `src-tauri/src/git/model.rs`. */

export type BranchKind = "local" | "remote";

export type Remote = {
  name: string;
  url: string;
};

export type Branch = {
  id: string;
  repoId: string;
  refName: string;
  /** `main` for locals, `origin/main` for remotes. */
  name: string;
  /** Name without the remote prefix, so a local and its remote pair up. */
  logicalName: string;
  kind: BranchKind;
  remote: string | null;
  commit: string;
  shortCommit: string;
  subject: string;
  author: string;
  committedAt: string | null;
  isHead: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  gone: boolean;
  checkedOutIn: string[];
};

export type Commit = {
  id: string;
  shortId: string;
  parents: string[];
  subject: string;
  author: string;
  committedAt: string;
};

export type Worktree = {
  id: string;
  repoId: string;
  name: string;
  path: string;
  head: string | null;
  shortHead: string | null;
  branch: string | null;
  detached: boolean;
  bare: boolean;
  locked: boolean;
  lockReason: string | null;
  prunable: boolean;
  prunableReason: string | null;
  isMain: boolean;
  exists: boolean;
};

export type Repository = {
  id: string;
  name: string;
  path: string;
  gitDir: string;
  bare: boolean;
  head: string | null;
  headDetached: boolean;
  defaultBranch: string | null;
  remotes: Remote[];
  branches: Branch[];
  worktrees: Worktree[];
  /** Newest first, in topological order. */
  commits: Commit[];
  historyTruncated: boolean;
  /**
   * The branch names this repository asks the graph to leave out, as its
   * `.totex/.graphignore` writes them — blank lines and comments already gone.
   *
   * Optional because these pages can be running on a program from before the
   * file was read at all, and a window that drew nothing rather than drawing
   * every branch would be a worse answer than ignoring nothing. See
   * `lib/graph/ignore`.
   */
  graphIgnore?: string[];
};

export type Workspace = {
  root: string;
  repositories: Repository[];
  warnings: string[];
};

/** Everything but the three lists, sent whole when any of it changed. */
export type RepositorySummary = Omit<Repository, "id" | "branches" | "worktrees" | "commits">;

/**
 * History as a diff: the bodies we have not seen, plus the resulting order.
 * Commits that dropped out of history are simply absent from the order.
 */
export type CommitDelta = {
  added: Commit[];
  order: string[];
};

/** The changed parts of one repository; an absent field did not move. */
export type RepositoryDelta = {
  id: string;
  summary?: RepositorySummary;
  branches?: Branch[];
  worktrees?: Worktree[];
  commits?: CommitDelta;
};

/** What a rescan actually changed. Mirrors `src-tauri/src/git/delta.rs`. */
export type WorkspaceDelta = {
  root: string;
  added: Repository[];
  changed: RepositoryDelta[];
  /** Ids of repositories that are gone. */
  removed: string[];
  /** Every repository id in display order, sent when the set or order moved. */
  order?: string[];
  warnings?: string[];
};

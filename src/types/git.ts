/** Mirrors the serde types in src-tauri/src/git/model.rs. */
export type BranchKind = "local" | "remote";

export type Remote = {
  name: string;
  url: string;
};

export type Branch = {
  id: string;
  repoId: string;
  /** `main` for locals, `origin/main` for remotes. */
  refName: string;
  name: string;
  /** Without the remote prefix, so a local and its remote pair up. */
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
  commits: Commit[];
  historyTruncated: boolean;
  /** From `.totex/.graphignore`; optional because an older backend never read it. */
  graphIgnore?: string[];
};

export type Workspace = {
  root: string;
  repositories: Repository[];
  warnings: string[];
};

export type RepositorySummary = Omit<Repository, "id" | "branches" | "worktrees" | "commits">;

export type CommitDelta = {
  added: Commit[];
  order: string[];
};

export type RepositoryDelta = {
  id: string;
  summary?: RepositorySummary;
  branches?: Branch[];
  worktrees?: Worktree[];
  commits?: CommitDelta;
};

/** Mirrors src-tauri/src/git/delta.rs; an absent field did not move. */
export type WorkspaceDelta = {
  root: string;
  added: Repository[];
  changed: RepositoryDelta[];
  removed: string[];
  order?: string[];
  warnings?: string[];
};

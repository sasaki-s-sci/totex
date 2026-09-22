import type { Branch, Commit, Repository, Worktree } from "../../types/git";
import type { GraphedKind } from "../graphed";

export type CommitNodeData = {
  commit: Commit;
  repository: Repository;
  branches: Branch[];
  worktrees: Worktree[];
  /** A parent is outside the history handed over: the line really ends here. */
  boundary: boolean;
  /** A parent is known but folded away and the fold's own dash does not reach here. */
  folded: boolean;
};

export type RefKind = "local" | "remote" | "worktree";

/** Local and remote refs are paired by name, the guess `git switch` makes. */
export type Fetch = {
  remote: string;
  branch: string;
  /** The local end's worktree; a fetch is offered only over a clean one. */
  work: string | null;
};

/** The remote end as the local end sees it; syncing moves the local end. */
export type Origin = {
  head: string;
  remote: string;
  branch: string;
};

export type BranchHeadData = {
  repository: Repository;
  kind: RefKind;
  name: string;
  hasRemote: boolean;
  /** Paired ends on one commit: two nodes sharing a grid point. */
  together: boolean;
  fetch: Fetch | null;
  /** Local end only; a remote-tracking ref has nothing to be brought level with. */
  origin: Origin | null;
  cwd: string | null;
  /** Proposed by a history pull not yet let go of; see `useHistoryPull`. */
  provisional?: boolean;
};

export type RepositoryNodeData = {
  repository: Repository;
  /**
   * Band-relative box of the heading: the name and mark on the trunk line, ahead of the history,
   * with the length rail on the line above them.
   */
  label: { x: number; y: number; width: number; height: number };
};

export type FolderNodeData = {
  /** Drawn as the folder it is or as the one repository it is; the grip wears the difference. */
  kind: GraphedKind;
  root: string;
  name: string;
  label: { x: number; y: number; width: number; height: number };
  /** Every repository in it opened out; pressing the name toggles the lot. */
  open: boolean;
  /** Band-relative left edge of the folder's own mark, which the group is dragged by. */
  mark: number;
};

import { createContext, useContext } from "react";
import type { Ask } from "../lib/ask";
import type { Fetch, RefKind } from "../lib/graph";
import type { Session } from "../lib/session";
import type { WorktreeStatus } from "../lib/workspace";
import type { FilePageActions } from "../page/actions";
import type { Repository } from "../types/git";

export type WorkRequest = {
  repository: Repository | null;

  branch: string;

  cwd: string | null;
};

export type WorktreeBrowseRequest = WorkRequest & { repository: Repository };

export type FetchRequest = {
  repository: Repository;

  branch: string;
  fetch: Fetch;
};

export type BranchPick = {
  repository: Repository;
  branch: string;
  kind: RefKind;
  cwd: string | null;

  status?: WorktreeStatus;
  at: { x: number; y: number };
};

/** Through context, not node data: React Flow redraws by comparing node data, and a rebuilt callback would make every node look changed. */
export type GraphActions = FilePageActions & {
  openWork: (request: WorkRequest) => void;

  /** A branch cut off the repository's main line, a worktree for it, and a terminal in that. */
  newWork: (repository: Repository) => void;

  browseWorktree: (request: WorktreeBrowseRequest) => void;

  pickBranch: (pick: BranchPick) => void;

  dragBranch: (repository: Repository, branch: string, event: React.PointerEvent) => void;

  fetchBranch: (request: FetchRequest) => void;

  closeRepository: (repository: Repository) => void;

  openRepository: (repository: string) => void;

  foldRepository: (repository: string) => void;

  toggleJunction: (junction: string) => void;

  expand: (repository: string) => void;

  fold: (repository: string, shown: number) => void;

  /** As `fold`, but the canvas stays where it is: the rail asking stands on the heading, which must not leave the pointer. */
  setLength: (repository: string, shown: number) => void;

  reachFold: (repository: string, shown: number | null) => void;

  keepFold: (repository: string) => void;

  showSession: (session: Session) => void;

  endSession: (session: Session) => void;

  collapseCliPage: (sessionId: string) => void;

  fitCliPage: (sessionId: string, width: number, height: number) => void;

  answer: (session: Session, ask: Ask, key: string) => void;

  reply: (session: Session, ask: Ask, text: string) => void;

  point: (session: Session, ask: Ask, key: string) => void;

  pick: (session: Session, ask: Ask, key: string) => void;

  take: (session: Session, ask: Ask) => void;
};

export const NO_ACTIONS: GraphActions = {
  openWork: () => {},
  newWork: () => {},
  browseWorktree: () => {},
  pickBranch: () => {},
  dragBranch: () => {},
  fetchBranch: () => {},
  closeRepository: () => {},
  openRepository: () => {},
  foldRepository: () => {},
  toggleJunction: () => {},
  expand: () => {},
  fold: () => {},
  setLength: () => {},
  reachFold: () => {},
  keepFold: () => {},
  showSession: () => {},
  endSession: () => {},
  collapseCliPage: () => {},
  fitCliPage: () => {},
  answer: () => {},
  reply: () => {},
  point: () => {},
  pick: () => {},
  take: () => {},
  closeFilePreview: () => {},
  saveFilePreview: async () => false,
  collapseFilePreview: () => {},
  setFilePreviewView: () => {},
  previewFilePreview: () => {},
  fitFilePreview: () => {},
  pinFilePreview: () => {},
};

const GraphActionsContext = createContext<GraphActions>(NO_ACTIONS);

export const GraphActionsProvider = GraphActionsContext.Provider;

export function useGraphActions(): GraphActions {
  return useContext(GraphActionsContext);
}

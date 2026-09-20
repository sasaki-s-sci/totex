import { createContext, useContext } from "react";

import type { Ask } from "../lib/ask";
import type { Fetch, RefKind } from "../lib/graph";
import type { Session } from "../lib/session";
import type { WorktreeStatus } from "../lib/workspace";
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
export type GraphActions = {
  openWork: (request: WorkRequest) => void;

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

  reachFold: (repository: string, shown: number | null) => void;

  keepFold: (repository: string) => void;

  showSession: (session: Session) => void;

  endSession: (session: Session) => void;

  dockSession: (session: Session) => void;

  collapseCliPage: (sessionId: string) => void;

  fitCliPage: (sessionId: string, width: number, height: number) => void;

  answer: (session: Session, ask: Ask, key: string) => void;

  reply: (session: Session, ask: Ask, text: string) => void;

  point: (session: Session, ask: Ask, key: string) => void;

  pick: (session: Session, ask: Ask, key: string) => void;

  take: (session: Session, ask: Ask) => void;

  closeFilePreview: (requestId: number) => void;

  saveFilePreview: (requestId: number, text: string, expected?: string) => Promise<boolean>;

  collapseFilePreview: (requestId: number) => void;

  setFilePreviewView: (
    requestId: number,
    view: import("../lib/filePreview").FilePreviewView,
  ) => void;

  previewFilePreview: (requestId: number) => void;

  fitFilePreview: (requestId: number, width: number, height?: number) => void;

  pinFilePreview: (requestId: number) => void;
};

export const NO_ACTIONS: GraphActions = {
  openWork: () => {},
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
  reachFold: () => {},
  keepFold: () => {},
  showSession: () => {},
  endSession: () => {},
  dockSession: () => {},
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

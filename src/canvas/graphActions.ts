import { createContext, useContext } from "react";
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

export type GraphActions = FilePageActions & {
  openWork: (request: WorkRequest) => void;
  newWork: (repository: Repository) => void;
  browseWorktree: (request: WorktreeBrowseRequest) => void;
  pickBranch: (pick: BranchPick) => void;
  closeRepository: (repository: Repository) => void;
  closeFolder: (root: string) => void;
  endSession: (session: Session) => void;
};

export const NO_ACTIONS: GraphActions = {
  openWork: () => {},
  newWork: () => {},
  browseWorktree: () => {},
  pickBranch: () => {},
  closeRepository: () => {},
  closeFolder: () => {},
  endSession: () => {},
  closeFilePreview: () => {},
  saveFilePreview: async () => false,
  refreshFilePreview: () => {},
  setFilePreviewView: () => {},
  previewFilePreview: () => {},
  openLinkedFile: () => {},
};

const GraphActionsContext = createContext<GraphActions>(NO_ACTIONS);

export const GraphActionsProvider = GraphActionsContext.Provider;

export function useGraphActions(): GraphActions {
  return useContext(GraphActionsContext);
}

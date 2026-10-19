import type { Folder } from "../hooks/useWorkspace";
import type { CardSeed } from "../lib/cardWindow";
import type { Doing } from "../lib/doing";
import type { FilePreviewRequest, FilePreviewView } from "../lib/filePreview";
import type { CommitFlowNode, Origin } from "../lib/graph";
import type { Report } from "../lib/mcp";
import type { Session } from "../lib/session";
import type { Repository, Workspace } from "../types/git";
import type { BranchPick, FetchRequest, WorkRequest, WorktreeBrowseRequest } from "./graphActions";
import type { GraphMarks } from "./graphMarks";

export type MergeRequest = {
  repository: Repository;
  source: string;
  target: string;
};

export type SyncRequest = {
  repository: Repository;

  branch: string;
  origin: Origin;
};

export type CanvasProps = {
  workspace: Workspace;

  folders: readonly Folder[];

  browsing: readonly string[];

  sessions: readonly Session[];

  showing: string | null;

  paged: readonly string[];

  reports: ReadonlyMap<string, Report>;

  doings: ReadonlyMap<string, Doing>;

  marks: GraphMarks;

  onSelect: (node: CommitFlowNode, at: { x: number; y: number }) => void;

  onNewWork: (repository: Repository) => void;
  onOpenWork: (request: WorkRequest) => void;
  onBrowseWorktree: (request: WorktreeBrowseRequest) => void;
  onPickBranch: (pick: BranchPick) => void;

  onCloseRepository: (repository: Repository) => void;

  onCloseFolder: (root: string) => void;

  onMerge: (request: MergeRequest) => void;

  onSync: (request: SyncRequest) => void;

  onFetch: (request: FetchRequest) => void;
  onShowSession: (session: Session) => void;

  onJumpSession: (session: Session) => void;
  onEndSession: (session: Session) => void;
  onPlaceSession: (moved: Session, anchor: Session, below: boolean) => void;

  filePreviews: readonly FilePreviewRequest[];

  onPreviewFile: (path: string, beside: number, view?: FilePreviewView, again?: boolean) => void;
  onCloseFilePreview: (requestId: number) => void;

  onOpenPinned: (seed: CardSeed, at: { x: number; y: number }) => void;

  settingsRequest: number;
  onCloseSettings: () => void;
};

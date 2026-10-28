import type { Folder } from "../hooks/useWorkspace";
import type { FilePreviewRequest, FilePreviewView } from "../lib/filePreview";
import type { Session } from "../lib/session";
import type { Repository, Workspace } from "../types/git";
import type { BranchPick, WorkRequest, WorktreeBrowseRequest } from "./graphActions";

export type CanvasProps = {
  workspace: Workspace;

  folders: readonly Folder[];

  sessions: readonly Session[];

  showing: string | null;

  onNewWork: (repository: Repository) => void;
  onOpenWork: (request: WorkRequest) => void;
  onBrowseWorktree: (request: WorktreeBrowseRequest) => void;
  onPickBranch: (pick: BranchPick) => void;

  onCloseRepository: (repository: Repository) => void;

  onCloseFolder: (root: string) => void;

  onEndSession: (session: Session) => void;

  filePreviews: readonly FilePreviewRequest[];

  onPreviewFile: (path: string, beside: number, view?: FilePreviewView, again?: boolean) => void;
  onCloseFilePreview: (requestId: number) => void;

  settingsRequest: number;
  onCloseSettings: () => void;
};

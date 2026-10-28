import type { FilePreviewView } from "../filePreview";

export type RefKind = "local" | "remote" | "worktree";

export type Fetch = {
  remote: string;
  branch: string;
  work: string | null;
};

export type Origin = {
  head: string;
  remote: string;
  branch: string;
};

export type FilePreviewBox = { width: number; height: number };

export type FilePreviewNodeData = {
  requestId: number;
  path: string;
  name: string;
  text: string | null;
  /** A data URL of the whole file, or null when not a picture or too large to read. */
  picture: string | null;
  size: number | null;
  truncated: boolean;
  state: "loading" | "ready" | "failed";
  view: FilePreviewView;
  box: FilePreviewBox;
  collapsed: boolean;
  pinnedScale?: number;
  pinnedAt: { x: number; y: number } | null;
};

/** File state retains its snapshot shape when restoring older workspaces. */
export type FilePreviewFlowNode = {
  id: string;
  type: "file-preview";
  data: FilePreviewNodeData;
  position: { x: number; y: number };
  hidden?: boolean;
  width?: number;
  height?: number;
};

export type AppNode = FilePreviewFlowNode;

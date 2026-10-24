import type { Node } from "@xyflow/react";

import type {
  CliNodeData,
  CliPageNodeData,
  CollapseNodeData,
  FilePreviewNodeData,
  JunctionNodeData,
  OfferData,
  RepoMarkData,
} from "./marks";
import type { BranchHeadData, CommitNodeData, FolderNodeData, RepositoryNodeData } from "./nodes";
import type { ReportFlowNode } from "./reporting";
import type { TileFlowNode } from "./tiles";

export type CommitFlowNode = Node<CommitNodeData, "commit">;
export type BranchHeadFlowNode = Node<BranchHeadData, "head">;
export type CollapseFlowNode = Node<CollapseNodeData, "collapse">;
export type JunctionFlowNode = Node<JunctionNodeData, "junction">;
export type RepositoryFlowNode = Node<RepositoryNodeData, "repository">;
export type FolderFlowNode = Node<FolderNodeData, "folder">;
export type RepoMarkFlowNode = Node<RepoMarkData, "repo-mark">;
export type CliFlowNode = Node<CliNodeData, "cli">;
export type OfferFlowNode = Node<OfferData, "offer">;
export type FilePreviewFlowNode = Node<FilePreviewNodeData, "file-preview">;
export type CliPageFlowNode = Node<CliPageNodeData, "cli-page">;
export type AppNode =
  | TileFlowNode
  | CommitFlowNode
  | BranchHeadFlowNode
  | CollapseFlowNode
  | JunctionFlowNode
  | RepositoryFlowNode
  | FolderFlowNode
  | RepoMarkFlowNode
  | CliFlowNode
  | OfferFlowNode
  | ReportFlowNode
  | FilePreviewFlowNode
  | CliPageFlowNode;

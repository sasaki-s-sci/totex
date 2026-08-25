/**
 * The node types React Flow is handed, and the union of all of them.
 */

import type { Node } from "@xyflow/react";

import type { AskFlowNode } from "./asking";
import type { CliNodeData, CollapseNodeData, FilePreviewNodeData, RepoMarkData } from "./marks";
import type { BranchHeadData, CommitNodeData, FolderNodeData, RepositoryNodeData } from "./nodes";
import type { ReportFlowNode } from "./reporting";

export type CommitFlowNode = Node<CommitNodeData, "commit">;
export type BranchHeadFlowNode = Node<BranchHeadData, "head">;
export type CollapseFlowNode = Node<CollapseNodeData, "collapse">;
export type RepositoryFlowNode = Node<RepositoryNodeData, "repository">;
export type FolderFlowNode = Node<FolderNodeData, "folder">;
export type RepoMarkFlowNode = Node<RepoMarkData, "repo-mark">;
export type CliFlowNode = Node<CliNodeData, "cli">;
export type FilePreviewFlowNode = Node<FilePreviewNodeData, "file-preview">;
export type AppNode =
  | CommitFlowNode
  | BranchHeadFlowNode
  | CollapseFlowNode
  | RepositoryFlowNode
  | FolderFlowNode
  | RepoMarkFlowNode
  | CliFlowNode
  | AskFlowNode
  | ReportFlowNode
  | FilePreviewFlowNode;

/**
 * One line of the graph: the two marks it joins, and how it gets from one to
 * the other.
 *
 * History is lines, and there are as many of them as there are commits. Given
 * to the engine one element apiece — which is what an edge per line comes to —
 * they were half of everything on the canvas and the greater part of what a
 * frame cost. So a line is this instead: the ends it runs between, which the
 * canvas turns into a piece of path data and joins to every other line drawn
 * the same way.
 *
 * The ends are named rather than placed, because where a mark is and where its
 * line ends have to be the same answer. A repository laid out again walks its
 * commits to their new places over a few frames, and a line drawn from what the
 * layout says rather than from where the mark actually is would leave the dots
 * walking and the lines already arrived.
 *
 * What the pointer can do with a line is not drawn at all until it is on one;
 * see `FoldTarget` and `GraphLines`.
 */

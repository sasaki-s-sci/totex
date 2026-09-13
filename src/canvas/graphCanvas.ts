import type { NodeTypes } from "@xyflow/react";
import { type AppNode, isPage } from "../lib/graph";
import { AskNode } from "./nodes/AskNode";
import { BranchHeadNode } from "./nodes/BranchHeadNode";
import { CliNode } from "./nodes/CliNode";
import { CliPageNode } from "./nodes/CliPageNode";
import { CollapseNode } from "./nodes/CollapseNode";
import { FilePreviewNode } from "./nodes/FilePreviewNode";
import { FolderNode } from "./nodes/FolderNode";
import { JunctionNode } from "./nodes/JunctionNode";
import { RepoMarkNode } from "./nodes/RepoMarkNode";
import { ReportNode } from "./nodes/ReportNode";
import { RepositoryNode } from "./nodes/RepositoryNode";

export const nodeTypes = {
  repository: RepositoryNode,
  folder: FolderNode,
  "repo-mark": RepoMarkNode,
  head: BranchHeadNode,
  collapse: CollapseNode,
  junction: JunctionNode,
  cli: CliNode,
  ask: AskNode,
  report: ReportNode,
  "file-preview": FilePreviewNode,
  "cli-page": CliPageNode,
} satisfies NodeTypes;

export const proOptions = { hideAttribution: true };

/** Below this the branch offer is a few pixels of grey and is not drawn. */
export const DETAIL_ZOOM = 0.3;

export const DETAIL_GAP = 1.2;

/** A controlled React Flow reports every drag frame as a new array; cards have no lines, so the line layer keeps the old one while only pages move. */
export function retainLineNodes(
  nodes: readonly AppNode[],
  held: readonly AppNode[],
): readonly AppNode[] {
  let index = 0;
  let same = true;
  for (const node of nodes) {
    if (isPage(node)) continue;
    if (held[index] !== node) same = false;
    index += 1;
  }

  if (same && held.length === index) return held;
  return nodes.filter((node) => !isPage(node));
}

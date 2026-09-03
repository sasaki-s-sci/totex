/**
 * What React Flow is handed about this canvas: which node draws which type, and
 * the two thresholds the canvas reads its own zoom against.
 */

import type { NodeTypes } from "@xyflow/react";
import type { AppNode } from "../lib/graph";
import { AskNode } from "./nodes/AskNode";
import { BranchHeadNode } from "./nodes/BranchHeadNode";
import { CliNode } from "./nodes/CliNode";
import { CollapseNode } from "./nodes/CollapseNode";
import { FilePreviewNode } from "./nodes/FilePreviewNode";
import { FolderNode } from "./nodes/FolderNode";
import { JunctionNode } from "./nodes/JunctionNode";
import { RepoMarkNode } from "./nodes/RepoMarkNode";
import { ReportNode } from "./nodes/ReportNode";
import { RepositoryNode } from "./nodes/RepositoryNode";
import { SettingsNodePart } from "./nodes/SettingsNodePart";

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
  settings: SettingsNodePart,
} satisfies NodeTypes;

/** The canvas is the whole window here; the badge sits on top of the graph. */
export const proOptions = { hideAttribution: true };

/** Lets React Flow measure the nodes it was just handed before re-framing. */
export const FIT_DELAY_MS = 80;

/**
 * The scale below which the offer of a terminal stops being drawn.
 *
 * A third of full size: the button on a branch's ring is then about a fifth of
 * the size a pointer can be aimed at, and what it is drawn in is four pixels of
 * grey. What is left out there is the shape of the history, which is what the
 * canvas is taken out to see.
 *
 * Said to the stylesheet rather than answered by leaving something out: the
 * button is part of a branch's own mark now, and a branch is drawn at every
 * scale.
 */
export const DETAIL_ZOOM = 0.3;
/** How far past the threshold the canvas has to come back for them to return. */
export const DETAIL_GAP = 1.2;

/**
 * Keeps the line layer's input stable while only file cards are changing.
 *
 * A controlled React Flow reports every drag frame as a new node array. File
 * cards have no lines, but handing that array to `GraphLines` made it rebuild
 * every history path while a card moved. Comparing the relevant objects is a
 * small linear pass and lets the memoized line layer sleep through the drag.
 */
export function retainLineNodes(
  nodes: readonly AppNode[],
  held: readonly AppNode[],
): readonly AppNode[] {
  let index = 0;
  let same = true;
  for (const node of nodes) {
    if (node.type === "file-preview" || node.type === "settings") continue;
    if (held[index] !== node) same = false;
    index += 1;
  }

  if (same && held.length === index) return held;
  return nodes.filter((node) => node.type !== "file-preview" && node.type !== "settings");
}

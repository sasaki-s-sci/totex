/**
 * What a file card is: the size it stands at, and the name its node goes under.
 * The layer every page stands on is `PAGE_Z`, beside the rest of what places
 * one.
 */

import type { FilePreviewBox, FilePreviewFlowNode } from "../lib/graph";

export const FILE_PREVIEW_SIZE = { width: 360, height: 240 } as const;

export function fileNodeId(requestId: number): string {
  return `file-preview:${requestId}`;
}

/**
 * The size a card is standing at: its own once an edge has been dragged, and
 * the size it was opened at until then. A card put away has no height of its
 * own, so the box keeps the one it had.
 */
export function fileSize(node: FilePreviewFlowNode): FilePreviewBox {
  const box = node.data.box;
  return { width: node.width ?? box.width, height: node.height ?? box.height };
}

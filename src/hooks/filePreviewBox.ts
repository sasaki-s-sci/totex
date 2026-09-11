/**
 * What a file card is: the size it stands at, and the name its node goes under.
 * The layer every page stands on is `PAGE_Z`, beside the rest of what places
 * one.
 */

import type { FilePreviewBox, FilePreviewFlowNode } from "../lib/graph";

export const FILE_PREVIEW_SIZE = { width: 360, height: 160 } as const;

export function fileNodeId(requestId: number): string {
  return `file-preview:${requestId}`;
}

/**
 * The size a card is standing at: its own once an edge has been dragged, and
 * the size it was opened at until then. A card put away has no height of its
 * own, so the box keeps the one it had.
 *
 * Always in canvas units, pinned or not: a pinned card is drawn scaled by the
 * zoom it was pinned at rather than measured again, so pinning and unpinning
 * leave the box exactly as it was.
 */
export function fileSize(node: FilePreviewFlowNode): FilePreviewBox {
  const box = node.data.box;
  return { width: node.width ?? box.width, height: node.height ?? box.height };
}

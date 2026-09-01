/**
 * What a file card is: the size it stands at, and the name its node goes under.
 * The layer every page stands on is `PAGE_Z`, beside the rest of what places
 * one.
 */

import { MIN_HEIGHT, MIN_WIDTH } from "../components/nodes/FilePreviewNode";
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

/**
 * A box a card is still a card at. Stepping on and off the canvas multiplies a
 * card's box by the zoom, and a graph taken far out would pin a card at a few
 * pixels of itself.
 */
export function readableSize(box: FilePreviewBox): FilePreviewBox {
  return { width: Math.max(MIN_WIDTH, box.width), height: Math.max(MIN_HEIGHT, box.height) };
}

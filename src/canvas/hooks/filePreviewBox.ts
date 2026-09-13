import type { FilePreviewBox, FilePreviewFlowNode } from "../../lib/graph";

export const FILE_PREVIEW_SIZE = { width: 360, height: 160 } as const;

export const FILE_LEAST = { width: 180, height: 96 } as const;

export const SETTINGS_LEAST = { width: 520, height: 220 } as const;

export function fileLeast(node: FilePreviewFlowNode): FilePreviewBox {
  return node.data.view === "settings" ? SETTINGS_LEAST : FILE_LEAST;
}

export function fileNodeId(requestId: number): string {
  return `file-preview:${requestId}`;
}

// Always canvas units, pinned or not: a pinned card is drawn scaled by its pin zoom, never remeasured.
export function fileSize(node: FilePreviewFlowNode): FilePreviewBox {
  const box = node.data.box;
  return { width: node.width ?? box.width, height: node.height ?? box.height };
}

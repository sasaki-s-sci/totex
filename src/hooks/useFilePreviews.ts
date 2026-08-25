/**
 * The file cards on the canvas.
 *
 * A card belongs to the canvas but not to a repository rebuild, so none of this
 * goes through the graph: placing and reading is one half — see
 * `useFilePreviewPlacing` — and what a standing card can be asked to do is the
 * other, in `useFilePreviewCard`.
 */

import type { Edge, ReactFlowInstance } from "@xyflow/react";
import type { RefObject } from "react";
import type { FilePreviewRequest } from "../lib/filePreview";
import type { AppNode } from "../lib/graph";
import { useFilePreviewCard } from "./useFilePreviewCard";
import { useFilePreviewPlacing } from "./useFilePreviewPlacing";

export { fileSize } from "./filePreviewBox";

export type FilePreviewCanvas = {
  /** The canvas element, which pinned cards are placed in the pixels of. */
  host: RefObject<HTMLDivElement | null>;
  instance: RefObject<ReactFlowInstance<AppNode, Edge> | null>;
  /** Where everything is standing on screen right now. */
  standing: RefObject<readonly AppNode[]>;
  nodes: readonly AppNode[];
  setNodes: (update: (current: AppNode[]) => AppNode[]) => void;
  flowReady: boolean;
};

export function useFilePreviews(
  requests: readonly FilePreviewRequest[],
  canvas: FilePreviewCanvas,
) {
  useFilePreviewPlacing(requests, canvas);
  return useFilePreviewCard(canvas);
}

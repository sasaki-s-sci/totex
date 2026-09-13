import type { Edge, ReactFlowInstance } from "@xyflow/react";
import type { RefObject } from "react";
import type { FilePreviewRequest } from "../../lib/filePreview";
import type { AppNode } from "../../lib/graph";
import { type CardTraffic, useFilePreviewCard } from "./useFilePreviewCard";
import { useFilePreviewPlacing } from "./useFilePreviewPlacing";

export { fileSize } from "./filePreviewBox";

export type PageCanvas = {
  host: RefObject<HTMLDivElement | null>;
  instance: RefObject<ReactFlowInstance<AppNode, Edge> | null>;

  standing: RefObject<readonly AppNode[]>;
  nodes: readonly AppNode[];
  setNodes: (update: (current: AppNode[]) => AppNode[]) => void;
  flowReady: boolean;
};

export function useFilePreviews(
  requests: readonly FilePreviewRequest[],
  canvas: PageCanvas,
  previewFile: (path: string, beside: number) => void,
  windows: CardTraffic,
) {
  useFilePreviewPlacing(requests, canvas);
  return useFilePreviewCard(canvas, previewFile, windows);
}

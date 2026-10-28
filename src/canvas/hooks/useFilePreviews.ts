import type { RefObject } from "react";
import type { FilePreviewRequest, FilePreviewView } from "../../lib/filePreview";
import type { AppNode } from "../../lib/graph";
import { useFilePreviewCard } from "./useFilePreviewCard";
import { useFilePreviewPlacing } from "./useFilePreviewPlacing";

export { fileSize } from "./filePreviewBox";

export type PageCanvas = {
  standing: RefObject<readonly AppNode[]>;
  nodes: readonly AppNode[];
  setNodes: (update: (current: AppNode[]) => AppNode[]) => void;
};

export function useFilePreviews(
  requests: readonly FilePreviewRequest[],
  canvas: PageCanvas,
  previewFile: (path: string, beside: number, view?: FilePreviewView, again?: boolean) => void,
) {
  useFilePreviewPlacing(requests, canvas);
  return useFilePreviewCard(canvas, previewFile);
}

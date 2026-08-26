/**
 * Placing one file request on the canvas, and reading the file behind it.
 *
 * Each request is placed once in the current viewport and React Flow owns its
 * position from then on. Reading happens after the loading card appears, and
 * stays bounded by the backend even for very large files.
 */

import { useEffect, useRef } from "react";
import { readFileHead } from "../folder/api";
import { baseName } from "../folder/format";
import type { FilePreviewRequest } from "../lib/filePreview";
import type { FilePreviewFlowNode } from "../lib/graph";
import { FILE_PREVIEW_SIZE, FILE_PREVIEW_Z, fileNodeId, fileSize } from "./filePreviewBox";
import type { PageCanvas } from "./useFilePreviews";

/** The gap left between a card and the one opened beside it, so that the two
 *  read as two cards rather than as one split down the middle. */
const BESIDE_GAP = 12;

export function useFilePreviewPlacing(
  requests: readonly FilePreviewRequest[],
  { host, instance, standing, setNodes, flowReady }: PageCanvas,
) {
  // bounded by the backend even for very large files.
  const placedFiles = useRef(new Set<number>());
  useEffect(() => {
    if (!flowReady || !instance.current) return;
    const wanted = new Set(requests.map((preview) => preview.id));
    for (const id of placedFiles.current) {
      if (!wanted.has(id)) placedFiles.current.delete(id);
    }

    const fresh = requests.filter((preview) => !placedFiles.current.has(preview.id));
    if (fresh.length === 0) {
      setNodes((current) => {
        const kept = current.filter(
          (node) => node.type !== "file-preview" || wanted.has(node.data.requestId),
        );
        return kept.length === current.length ? current : kept;
      });
      return;
    }

    const bounds = host.current?.getBoundingClientRect();
    const flow = instance.current;
    const additions: FilePreviewFlowNode[] = fresh.map((preview) => {
      placedFiles.current.add(preview.id);
      // A card opened from another one stands beside it, at its size and on
      // whichever layer it is standing on. Everything else is placed where it
      // was dropped, or in the middle of what the canvas is showing.
      const from = standing.current.find(
        (node): node is FilePreviewFlowNode =>
          node.type === "file-preview" && node.data.requestId === preview.beside,
      );
      const stagger = (placedFiles.current.size - 1) % 8;
      const screen = preview.at ?? {
        x: (bounds?.left ?? 0) + (bounds?.width ?? FILE_PREVIEW_SIZE.width) / 2 + stagger * 16,
        y: (bounds?.top ?? 0) + (bounds?.height ?? FILE_PREVIEW_SIZE.height) / 2 + stagger * 16,
      };
      const point = flow.screenToFlowPosition(screen);
      const box = from ? fileSize(from) : FILE_PREVIEW_SIZE;
      const corner = from
        ? { x: from.position.x + box.width + BESIDE_GAP, y: from.position.y }
        : { x: point.x - box.width / 2, y: point.y - 17 };
      // A preview of a card that has been pinned off the canvas is pinned
      // beside it, in the pane's own pixels: the two are being read against
      // each other, and one of them left the canvas.
      const pinnedAt = from?.data.pinnedAt
        ? { x: from.data.pinnedAt.x + box.width + BESIDE_GAP, y: from.data.pinnedAt.y }
        : null;
      return {
        id: fileNodeId(preview.id),
        type: "file-preview",
        position: corner,
        hidden: pinnedAt !== null,
        draggable: true,
        dragHandle: ".file-preview__header",
        zIndex: FILE_PREVIEW_Z,
        // Written on the node rather than into its style: a dragged edge is a
        // dimension change, and the node's own width wins over both.
        width: box.width,
        height: box.height,
        data: {
          requestId: preview.id,
          path: preview.path,
          name: baseName(preview.path),
          text: null,
          size: null,
          truncated: false,
          state: "loading",
          view: preview.view ?? "text",
          collapsed: false,
          box,
          pinnedAt,
        },
      };
    });

    setNodes((current) => [
      ...current.filter((node) => node.type !== "file-preview" || wanted.has(node.data.requestId)),
      ...additions,
    ]);

    for (const preview of fresh) {
      void readFileHead(preview.path)
        .then((head) => {
          if (!placedFiles.current.has(preview.id)) return;
          setNodes((current) =>
            current.map((node) =>
              node.type === "file-preview" && node.data.requestId === preview.id
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      path: head.path,
                      name: head.name,
                      text: head.text,
                      size: head.size,
                      truncated: head.truncated,
                      state: "ready",
                    },
                  }
                : node,
            ),
          );
        })
        .catch(() => {
          if (!placedFiles.current.has(preview.id)) return;
          setNodes((current) =>
            current.map((node) =>
              node.type === "file-preview" && node.data.requestId === preview.id
                ? { ...node, data: { ...node.data, state: "failed" } }
                : node,
            ),
          );
        });
    }
  }, [requests, flowReady, setNodes, host, instance, standing]);
}

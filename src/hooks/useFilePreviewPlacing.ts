/**
 * Placing one file request on the canvas, and reading the file behind it.
 *
 * Each request is placed once in the current viewport and React Flow owns its
 * position from then on. Reading happens after the loading card appears, and
 * stays bounded by the backend even for very large files.
 */

import { useEffect, useRef } from "react";
import { readFileData, readFileHead } from "../folder/api";
import { baseName } from "../folder/format";
import { type FilePreviewRequest, openingView, pictureType } from "../lib/filePreview";
import type { FilePreviewFlowNode, FilePreviewNodeData } from "../lib/graph";
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
          picture: null,
          size: null,
          truncated: false,
          state: "loading",
          view: preview.view ?? openingView(preview.path),
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

    // Asked of the cards that were just placed rather than of the requests they
    // came from: what a card is showing is what says how its file is read, and
    // the card is where that was settled.
    for (const { data } of additions) {
      const card = data.requestId;
      void (data.view === "picture" ? drawnFile(data.path) : readFile(data.path))
        .then((read) => {
          if (!placedFiles.current.has(card)) return;
          setNodes((current) =>
            current.map((node) =>
              node.type === "file-preview" && node.data.requestId === card
                ? { ...node, data: { ...node.data, ...read, state: "ready" } }
                : node,
            ),
          );
        })
        .catch(() => {
          if (!placedFiles.current.has(card)) return;
          setNodes((current) =>
            current.map((node) =>
              node.type === "file-preview" && node.data.requestId === card
                ? { ...node, data: { ...node.data, state: "failed" } }
                : node,
            ),
          );
        });
    }
  }, [requests, flowReady, setNodes, host, instance, standing]);
}

/** What of a file a card is given: as much of the head of it as one is drawn
 *  in, which is where a reading comes from. */
async function readFile(path: string): Promise<Partial<FilePreviewNodeData>> {
  const head = await readFileHead(path);
  return {
    path: head.path,
    name: head.name,
    text: head.text,
    size: head.size,
    truncated: head.truncated,
  };
}

/**
 * And the whole of one, for a card that draws it.
 *
 * The bytes arrive as base64 and are turned into the one thing an image is
 * drawn from without being decoded on the way — what a picture is written in is
 * the engine's to read, and this app never looks inside it. A file the layer
 * would not read the whole of comes back with nothing in it, and the card says
 * so rather than drawing half a picture.
 */
async function drawnFile(path: string): Promise<Partial<FilePreviewNodeData>> {
  const read = await readFileData(path);
  const type = pictureType(read.path) ?? "application/octet-stream";
  return {
    path: read.path,
    name: read.name,
    picture: read.data === null ? null : `data:${type};base64,${read.data}`,
    size: read.size,
  };
}

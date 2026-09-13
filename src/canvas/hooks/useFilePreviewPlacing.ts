import { useEffect, useRef } from "react";
import { readFileData, readFileHead } from "../../folder/api";
import { baseName } from "../../folder/format";
import {
  documentView,
  type FilePreviewRequest,
  type FilePreviewView,
  mediaType,
  mediaView,
  openingView,
  pictureType,
  SETTINGS_REQUEST_ID,
} from "../../lib/filePreview";
import type { FilePreviewFlowNode, FilePreviewNodeData } from "../../lib/graph";
import { gridNow, placeOnGrid } from "../../lib/grid";
import { readyAfter } from "../../shell/bridge";
import { frontValue } from "../../shell/state";
import { FILE_LEAST, FILE_PREVIEW_SIZE, fileNodeId, fileSize } from "./filePreviewBox";
import { canvasMiddle, PAGE_HANDLE, PAGE_Z, pageCorner } from "./pagePlacing";
import type { PageCanvas } from "./useFilePreviews";

const BESIDE_GAP = 12;

export function useFilePreviewPlacing(
  requests: readonly FilePreviewRequest[],
  { host, instance, standing, setNodes, flowReady }: PageCanvas,
) {
  const placedFiles = useRef(new Set<number>());
  useEffect(() => {
    if (!flowReady || !instance.current) return;
    const wanted = new Set([SETTINGS_REQUEST_ID, ...requests.map((preview) => preview.id)]);
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
    const grid = gridNow();
    const additions: FilePreviewFlowNode[] = fresh.map((preview) => {
      placedFiles.current.add(preview.id);
      const kept = frontValue<FilePreviewFlowNode[]>("canvas.files")?.find(
        (node) => node.data.requestId === preview.id && node.data.path === preview.path,
      );
      if (kept) return kept;

      const from = standing.current.find(
        (node): node is FilePreviewFlowNode =>
          node.type === "file-preview" && node.data.requestId === preview.beside,
      );
      const stagger = (placedFiles.current.size - 1) % 8;
      const asked = preview.pinned
        ? preview.pinned.box
        : from
          ? fileSize(from)
          : documentView(preview.path) ||
              mediaView(preview.path) ||
              preview.view === "html" ||
              /\.(csv|tsv)$/i.test(preview.path)
            ? { width: 560, height: 480 }
            : FILE_PREVIEW_SIZE;
      const wanted = from
        ? { x: from.position.x + asked.width + BESIDE_GAP, y: from.position.y }
        : pageCorner(flow, preview.at ?? canvasMiddle(bounds, asked, stagger * 16), asked);

      const { position: corner, box } =
        grid.holding && !preview.pinned && !from?.data.pinnedAt
          ? placeOnGrid(wanted, asked, grid.step, FILE_LEAST)
          : { position: wanted, box: asked };

      const pinnedAt = preview.pinned
        ? preview.pinned.at
        : from?.data.pinnedAt
          ? {
              x: from.data.pinnedAt.x + box.width * (from.data.pinnedScale ?? 1) + BESIDE_GAP,
              y: from.data.pinnedAt.y,
            }
          : null;
      const collapsed = preview.pinned?.collapsed ?? false;
      return {
        id: fileNodeId(preview.id),
        type: "file-preview",
        position: corner,
        hidden: pinnedAt !== null,
        draggable: true,
        dragHandle: PAGE_HANDLE,
        zIndex: PAGE_Z,

        width: box.width,
        height: collapsed ? undefined : box.height,
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
          collapsed,
          box,
          pinnedAt,
          pinnedScale: preview.pinned?.scale ?? from?.data.pinnedScale,
        },
      };
    });

    setNodes((current) => [
      ...current.filter(
        (node) =>
          node.type !== "file-preview" ||
          (wanted.has(node.data.requestId) && !additions.some((added) => added.id === node.id)),
      ),
      ...additions,
    ]);

    for (const { data } of additions) {
      const card = data.requestId;
      void readyAfter(
        readFilePreview(data.path, data.view)
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
          }),
      );
    }
  }, [requests, flowReady, setNodes, host, instance, standing]);
}

export function readFilePreview(
  path: string,
  view: FilePreviewView,
): Promise<Partial<FilePreviewNodeData>> {
  return view === "picture" || documentView(path) || mediaView(path)
    ? drawnFile(path)
    : readFile(path);
}

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

// Base64 goes straight into a data URL; the bytes are never decoded here.
async function drawnFile(path: string): Promise<Partial<FilePreviewNodeData>> {
  const read = await readFileData(path);
  const type = pictureType(read.path) ?? mediaType(read.path) ?? "application/octet-stream";
  const source = type === "image/svg+xml" ? await readFile(path) : {};
  return {
    path: read.path,
    name: read.name,
    ...source,
    picture: read.data === null ? null : `data:${type};base64,${read.data}`,
    size: read.size,
  };
}

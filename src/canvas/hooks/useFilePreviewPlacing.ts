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
import { readyAfter } from "../../shell/bridge";
import { frontValue } from "../../shell/state";
import { FILE_PREVIEW_SIZE, fileNodeId, fileSize } from "./filePreviewBox";
import type { PageCanvas } from "./useFilePreviews";

export function useFilePreviewPlacing(
  requests: readonly FilePreviewRequest[],
  { standing, setNodes }: PageCanvas,
) {
  const placedFiles = useRef(new Set<number>());
  useEffect(() => {
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

    const additions: FilePreviewFlowNode[] = fresh.map((preview) => {
      placedFiles.current.add(preview.id);
      const kept = frontValue<FilePreviewFlowNode[]>("canvas.files")?.find(
        (node) => node.data.requestId === preview.id && node.data.path === preview.path,
      );
      if (kept)
        return {
          ...kept,
          hidden: false,
          height: fileSize(kept).height,
          data: { ...kept.data, collapsed: false, pinnedAt: null, pinnedScale: undefined },
        };

      const from = standing.current.find(
        (node): node is FilePreviewFlowNode =>
          node.type === "file-preview" && node.data.requestId === preview.beside,
      );
      const box = preview.pinned
        ? preview.pinned.box
        : from
          ? fileSize(from)
          : documentView(preview.path) ||
              mediaView(preview.path) ||
              preview.view === "html" ||
              /\.(csv|tsv)$/i.test(preview.path)
            ? { width: 560, height: 480 }
            : FILE_PREVIEW_SIZE;
      return {
        id: fileNodeId(preview.id),
        type: "file-preview",
        position: { x: 0, y: 0 },

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
          pinnedAt: null,
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
  }, [requests, setNodes, standing]);
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

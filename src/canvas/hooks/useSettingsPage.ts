import { useEffect, useRef } from "react";
import { refreshSettings, useSettingsDocument } from "../../lib/appSettings";
import { SETTINGS_REQUEST_ID } from "../../lib/filePreview";
import type { FilePreviewFlowNode } from "../../lib/graph";
import { fileNodeId, fileSize } from "./filePreviewBox";
import type { PageCanvas } from "./useFilePreviews";

const BOX = { width: 860, height: 480 };
export function useSettingsPage(request: number, { setNodes }: PageCanvas) {
  const placed = useRef(0);
  const document = useSettingsDocument();
  useEffect(() => {
    if (request) void refreshSettings();
  }, [request]);
  useEffect(() => {
    if (!request) {
      placed.current = 0;
      setNodes((current) => current.filter((node) => node.id !== fileNodeId(SETTINGS_REQUEST_ID)));
      return;
    }
    if (placed.current === request) return;
    placed.current = request;
    setNodes((current) => {
      const existing = current.find(
        (node): node is FilePreviewFlowNode =>
          node.type === "file-preview" && node.data.requestId === SETTINGS_REQUEST_ID,
      );
      const box = existing ? fileSize(existing) : BOX;
      if (existing)
        return current.map((node) =>
          node === existing
            ? {
                ...node,
                width: box.width,
                height: box.height,
                data: { ...node.data, collapsed: false, box },
              }
            : node,
        );
      const node: FilePreviewFlowNode = {
        id: fileNodeId(SETTINGS_REQUEST_ID),
        type: "file-preview",
        position: { x: 0, y: 0 },
        width: box.width,
        height: box.height,
        data: {
          requestId: SETTINGS_REQUEST_ID,
          path: document?.path ?? "~/.totex/totex.json",
          name: "totex.json",
          text: document?.text ?? null,
          picture: null,
          size: document ? new TextEncoder().encode(document.text).length : null,
          truncated: false,
          state: "ready",
          view: "settings",
          collapsed: false,
          box,
          pinnedAt: null,
        },
      };
      return [...current, node];
    });
  }, [request, document, setNodes]);

  // Form writes and file writes update every open view of this document.
  useEffect(() => {
    if (!document) return;
    setNodes((current) =>
      current.map((node) =>
        node.type === "file-preview" &&
        (node.data.requestId === SETTINGS_REQUEST_ID || node.data.path === document.path) &&
        node.data.text !== document.text
          ? {
              ...node,
              data: {
                ...node.data,
                path: document.path,
                text: document.text,
                size: new TextEncoder().encode(document.text).length,
                state: "ready",
              },
            }
          : node,
      ),
    );
  }, [document, setNodes]);
}

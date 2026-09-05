/** The gear opens the settings file through the same card as any other file. */
import { useEffect, useRef } from "react";
import { refreshSettings, useSettingsDocument } from "../lib/appSettings";
import { SETTINGS_REQUEST_ID } from "../lib/filePreview";
import type { FilePreviewFlowNode } from "../lib/graph";
import { fileNodeId, fileSize } from "./filePreviewBox";
import { canvasMiddle, PAGE_HANDLE, PAGE_Z } from "./pagePlacing";
import type { PageCanvas } from "./useFilePreviews";

const BOX = { width: 760, height: 390 };
export function useSettingsPage(
  request: number,
  { host, instance, setNodes, flowReady }: PageCanvas,
) {
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
    if (!flowReady || !instance.current || placed.current === request) return;
    placed.current = request;
    const center = instance.current.screenToFlowPosition(
      canvasMiddle(host.current?.getBoundingClientRect(), BOX),
    );
    setNodes((current) => {
      const existing = current.find(
        (node): node is FilePreviewFlowNode =>
          node.type === "file-preview" && node.data.requestId === SETTINGS_REQUEST_ID,
      );
      if (existing?.data.pinnedAt) return current;
      const box = existing ? fileSize(existing) : BOX;
      const position = { x: center.x - box.width / 2, y: center.y - box.height / 2 };
      if (existing)
        return current.map((node) =>
          node === existing
            ? {
                ...node,
                position,
                height: box.height,
                data: { ...node.data, collapsed: false },
              }
            : node,
        );
      const node: FilePreviewFlowNode = {
        id: fileNodeId(SETTINGS_REQUEST_ID),
        type: "file-preview",
        position,
        draggable: true,
        dragHandle: PAGE_HANDLE,
        zIndex: PAGE_Z,
        ...BOX,
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
          box: BOX,
          pinnedAt: null,
        },
      };
      return [...current, node];
    });
  }, [request, flowReady, document, host, instance, setNodes]);

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

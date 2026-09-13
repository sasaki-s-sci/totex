import { useCallback, useMemo } from "react";
import { writeFile } from "../../folder/api";
import { refreshChanges } from "../../folder/changes";
import { settingsDocument, writeSettingsText } from "../../lib/appSettings";
import type { CardSeed } from "../../lib/cardWindow";
import { drawn, previewable } from "../../lib/filePreview";
import type { FilePreviewFlowNode } from "../../lib/graph";
import { gridNow, sizeOnGrid, upToGrid } from "../../lib/grid";
import { fileLeast, fileSize } from "./filePreviewBox";
import { useCardWindows } from "./useCardWindows";
import type { PageCanvas } from "./useFilePreviews";
import { heldInPane, usePinDrag } from "./usePinDrag";

export type CardTraffic = {
  closeFilePreview: (requestId: number) => void;

  openPinned: (seed: CardSeed, at: { x: number; y: number }) => void;
};

export function useFilePreviewCard(
  { host, instance, standing, nodes, setNodes }: PageCanvas,
  previewFile: (path: string, beside: number) => void,
  windows: CardTraffic,
) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: the refs are the canvas's own and never change identity
  const saveFilePreview = useCallback(
    async (requestId: number, text: string, expected?: string) => {
      const node = standing.current.find(
        (candidate): candidate is FilePreviewFlowNode =>
          candidate.type === "file-preview" && candidate.data.requestId === requestId,
      );
      // A truncated card is never written: the head on screen would replace the whole file.
      if (!node || node.data.size === null || node.data.truncated) return false;
      try {
        const config = settingsDocument();
        const size =
          config?.path === node.data.path
            ? await writeSettingsText(text, expected ?? node.data.text ?? "")
            : await writeFile(node.data.path, text, node.data.size);

        setNodes((current) =>
          current.map((one) =>
            one.type === "file-preview" && one.data.path === node.data.path
              ? { ...one, data: { ...one.data, text, size } }
              : one,
          ),
        );

        refreshChanges();
        return true;
      } catch {
        return false;
      }
    },
    [setNodes],
  );

  const collapseFilePreview = useCallback(
    (requestId: number) => {
      setNodes((current) =>
        current.map((node) => {
          if (node.type !== "file-preview" || node.data.requestId !== requestId) return node;
          const collapsed = !node.data.collapsed;
          const size = fileSize(node);
          return {
            ...node,
            data: { ...node.data, collapsed, box: size },
            width: size.width,

            height: collapsed ? undefined : size.height,
          };
        }),
      );
    },
    [setNodes],
  );

  const setFilePreviewView = useCallback(
    (requestId: number, view: import("../../lib/filePreview").FilePreviewView) => {
      setNodes((current) =>
        current.map((node) =>
          node.type === "file-preview" && node.data.requestId === requestId
            ? { ...node, data: { ...node.data, view } }
            : node,
        ),
      );
    },
    [setNodes],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: the refs are the canvas's own and never change identity
  const previewFilePreview = useCallback(
    (requestId: number) => {
      const node = standing.current.find(
        (candidate): candidate is FilePreviewFlowNode =>
          candidate.type === "file-preview" && candidate.data.requestId === requestId,
      );
      if (!node || drawn(node.data.view) || !previewable(node.data.path)) return;
      previewFile(node.data.path, requestId);
    },
    [previewFile],
  );

  // Width is held to the pane: a minified file is one line, and a card that wide cannot be reached.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the refs are the canvas's own and never change identity
  const fitFilePreview = useCallback(
    (requestId: number, wanted: number, tall?: number) => {
      const room = host.current?.clientWidth ?? 0;
      const zoom = instance.current?.getViewport().zoom ?? 1;
      const grid = gridNow();
      setNodes((current) =>
        current.map((node) => {
          if (node.type !== "file-preview" || node.data.requestId !== requestId) return node;

          const most = room / (node.data.pinnedAt ? (node.data.pinnedScale ?? 1) : zoom);
          const fitted = room > 0 ? Math.min(wanted, most) : wanted;
          const asked = tall ?? fileSize(node).height;

          const held = grid.holding && !node.data.pinnedAt;
          const least = fileLeast(node);
          const width = held ? upToGrid(Math.max(fitted, least.width), grid.step) : fitted;
          const height = held ? sizeOnGrid(asked, grid.step, least.height) : asked;
          return {
            ...node,
            width,

            height: node.data.collapsed ? undefined : height,
            data: { ...node.data, box: { width, height } },
          };
        }),
      );
    },
    [setNodes],
  );

  // Pinned cards float over the canvas in pane pixels at the zoom they were pinned at; unpinning drops the node at the point under the card.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the refs are the canvas's own and never change identity
  const pinFilePreview = useCallback(
    (requestId: number) => {
      const flow = instance.current;
      const pane = host.current?.getBoundingClientRect();
      if (!flow || !pane) return;
      setNodes((current) =>
        current.map((node) => {
          if (node.type !== "file-preview" || node.data.requestId !== requestId) return node;
          const at = node.data.pinnedAt;
          if (at) {
            const box = fileSize(node);
            return {
              ...node,
              hidden: false,
              width: box.width,
              height: node.data.collapsed ? undefined : box.height,
              position: flow.screenToFlowPosition({ x: pane.left + at.x, y: pane.top + at.y }),
              data: { ...node.data, box, pinnedAt: null, pinnedScale: undefined },
            };
          }
          const corner = flow.flowToScreenPosition(node.position);
          const pinnedScale = flow.getViewport().zoom;
          return {
            ...node,
            hidden: true,
            data: {
              ...node.data,
              pinnedScale,

              pinnedAt: heldInPane(
                { x: corner.x - pane.left, y: corner.y - pane.top },
                pane,
                fileSize(node).width * pinnedScale,
              ),
            },
          };
        }),
      );
    },
    [setNodes],
  );

  const movePinned = useCallback(
    (requestId: number, at: { x: number; y: number }) => {
      setNodes((current) =>
        current.map((node) =>
          node.type === "file-preview" && node.data.requestId === requestId
            ? { ...node, data: { ...node.data, pinnedAt: at } }
            : node,
        ),
      );
    },
    [setNodes],
  );

  const tearing = useCardWindows({ host, standing, ...windows });
  const pinDrag = usePinDrag(host, movePinned, tearing);

  const pinnedFiles = useMemo(
    () =>
      nodes.filter(
        (node): node is FilePreviewFlowNode =>
          node.type === "file-preview" && node.data.pinnedAt !== null,
      ),
    [nodes],
  );
  return {
    saveFilePreview,
    collapseFilePreview,
    setFilePreviewView,
    previewFilePreview,
    fitFilePreview,
    pinFilePreview,
    pinDrag,
    pinnedFiles,
  };
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type FilePreviewView, openingView, previewView } from "../lib/filePreview";
import type { AppNode } from "../lib/graph";
import type { MediaPlayback } from "../lib/media";
import { FilePage } from "../page/FilePage";
import { frontValue, keepFrontValue } from "../shell/state";
import { readFilePreview } from "./hooks/useFilePreviewPlacing";
import { useFilePreviews } from "./hooks/useFilePreviews";
import type { CanvasFileView } from "./model";

export function CanvasFile({
  cacheKey,
  path,
  format,
  view,
  onViewChange,
  playback,
  onPlaybackChange,
  active,
  rangeAnchor,
  onCloseRange,
  open,
  remove,
  registerSave,
}: {
  cacheKey: string;
  path: string;
  format?: "picture" | "video" | "audio";
  view?: CanvasFileView;
  onViewChange?: (view: CanvasFileView) => void;
  playback?: MediaPlayback;
  onPlaybackChange?: (playback: MediaPlayback) => void;
  active?: boolean;
  rangeAnchor?: { left: number; top: number } | null;
  onCloseRange?: () => void;
  open: (path: string) => void;
  remove: () => Promise<void>;
  registerSave: (save: () => Promise<boolean>) => () => void;
}) {
  const requested =
    format ?? (view === "preview" ? previewView(path) : (view ?? openingView(path)));
  const [id] = useState(() => {
    const key = `canvas.file.${cacheKey}`;
    const known = frontValue<number>(key);
    if (known !== undefined) return known;
    const next = frontValue<number>("canvas.nextFile") ?? 1_000_000;
    keepFrontValue("canvas.nextFile", next + 1);
    keepFrontValue(key, next);
    return next;
  });
  const [nodes, setNodes] = useState<AppNode[]>([]);
  const standing = useRef(nodes);
  standing.current = nodes;
  const discarding = useRef(false);
  const register = useCallback(
    (save: () => Promise<boolean>) =>
      registerSave(() => (discarding.current ? Promise.resolve(true) : save())),
    [registerSave],
  );
  const requests = useMemo(() => [{ id, path, at: null, view: requested }], [id, path, requested]);
  const nodeView = nodes[0]?.data.view;
  const beforeViewChange = useRef<"loading" | "ready" | "failed" | null>(null);
  const canSwitch =
    nodes.length > 0 && (nodes[0].data.state !== "loading" || beforeViewChange.current !== null);
  useEffect(() => {
    if (!nodeView || !canSwitch) return;
    if (nodeView === requested) {
      const state = beforeViewChange.current;
      if (state) {
        beforeViewChange.current = null;
        setNodes((held) =>
          held.map((node) =>
            node.data.state === "loading" ? { ...node, data: { ...node.data, state } } : node,
          ),
        );
      }
      return;
    }
    let live = true;
    beforeViewChange.current ??= standing.current[0].data.state;
    setNodes((held) => held.map((node) => ({ ...node, data: { ...node.data, state: "loading" } })));
    void readFilePreview(path, requested)
      .then((read) => {
        if (live) {
          beforeViewChange.current = null;
          setNodes((held) =>
            held.map((node) => ({
              ...node,
              data: { ...node.data, ...read, view: requested, state: "ready" },
            })),
          );
        }
      })
      .catch(() => {
        if (live) {
          beforeViewChange.current = null;
          setNodes((held) =>
            held.map((node) => ({
              ...node,
              data: { ...node.data, view: requested, state: "failed" },
            })),
          );
        }
      });
    return () => {
      live = false;
    };
  }, [canSwitch, nodeView, requested, path]);
  const preview = useCallback(
    (file: string, _beside: number, view?: FilePreviewView, again?: boolean) => {
      if (file === path && !again)
        setNodes((held) =>
          held.map((node) => ({
            ...node,
            data: { ...node.data, view: view ?? previewView(path) },
          })),
        );
      else open(file);
    },
    [path, open],
  );
  const actions = useFilePreviews(requests, { nodes, standing, setNodes }, preview);
  const data = nodes[0]?.data;
  return data ? (
    <FilePage
      data={data}
      bare
      registerSave={register}
      playback={playback}
      onPlaybackChange={onPlaybackChange}
      active={active}
      rangeAnchor={rangeAnchor}
      onCloseRange={onCloseRange}
      actions={{
        ...actions,
        previewFilePreview:
          onViewChange && data.text !== null
            ? () => onViewChange(data.view === "text" ? "preview" : "text")
            : actions.previewFilePreview,
        closeFilePreview: () => {
          // This action is the explicit conflict/deletion discard, not normal pane removal.
          discarding.current = true;
          void remove().finally(() => {
            discarding.current = false;
          });
        },
        openLinkedFile: (_id, file) => open(file),
      }}
    />
  ) : null;
}

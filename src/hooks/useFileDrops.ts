/**
 * The file cards the window is holding, and the native drops that open them.
 *
 * Native file drops do not become browser drop events in a Tauri webview, so
 * they are listened for at the window boundary and turned into the CSS
 * coordinates React Flow expects. A drop over the explorer stays the explorer's;
 * only the canvas takes a card.
 */

import { getCurrentWindow } from "@tauri-apps/api/window";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { FilePreviewRequest } from "../lib/filePreview";

export function useFileDrops(main: RefObject<HTMLElement | null>) {
  const [filePreviews, setFilePreviews] = useState<FilePreviewRequest[]>([]);
  const nextFilePreview = useRef(0);

  const openFiles = useCallback((paths: readonly string[], at: { x: number; y: number } | null) => {
    setFilePreviews((current) => [
      ...current,
      ...paths.map((path, index) => ({
        id: nextFilePreview.current++,
        path,
        at: at ? { x: at.x + index * 18, y: at.y + index * 18 } : null,
      })),
    ]);
  }, []);

  const closeFilePreview = useCallback((requestId: number) => {
    setFilePreviews((current) => current.filter((preview) => preview.id !== requestId));
  }, []);

  // Native file drops do not become browser drop events in a Tauri webview.
  // Listen at the window boundary, then turn the physical point into the CSS
  // coordinates React Flow expects. Drops over the explorer stay the
  // explorer's; only the canvas accepts a preview card.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the ref is the window's own and never changes identity
  useEffect(() => {
    const appWindow = getCurrentWindow();
    let cancelled = false;
    let stop: (() => void) | null = null;

    void appWindow
      .onDragDropEvent(async ({ payload }) => {
        if (payload.type !== "drop" || payload.paths.length === 0) return;
        const scale = await appWindow.scaleFactor();
        if (cancelled) return;
        const at = { x: payload.position.x / scale, y: payload.position.y / scale };
        const bounds = main.current?.getBoundingClientRect();
        if (
          !bounds ||
          at.x < bounds.left ||
          at.x > bounds.right ||
          at.y < bounds.top ||
          at.y > bounds.bottom
        ) {
          return;
        }
        openFiles(payload.paths, at);
      })
      .then((unlisten) => {
        if (cancelled) unlisten();
        else stop = unlisten;
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [openFiles]);

  return { filePreviews, openFiles, closeFilePreview };
}

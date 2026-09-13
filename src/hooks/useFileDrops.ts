import { useCallback, useRef } from "react";
import { draftKey } from "../canvas/nodes/preview/draft";
import type { CardSeed } from "../lib/cardWindow";
import { drawn, type FilePreviewRequest, openingView, previewView } from "../lib/filePreview";
import { keepFrontValue, useFrontState } from "../shell/state";

export function useFileDrops() {
  const [filePreviews, setFilePreviews] = useFrontState<FilePreviewRequest[]>("files.open", []);
  const nextFilePreview = useRef(Math.max(-1, ...filePreviews.map((file) => file.id)) + 1);

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

  // One preview per file: a second press is answered by the card already standing.
  const previewFile = useCallback((path: string, beside: number) => {
    const id = nextFilePreview.current++;
    const view = previewView(path);
    setFilePreviews((current) =>
      current.some(
        (preview) => preview.path === path && drawn(preview.view ?? openingView(preview.path)),
      )
        ? current
        : [...current, { id, path, at: null, view, beside }],
    );
  }, []);

  // A new id: the draft is put where the new card looks before it is placed.
  const openPinned = useCallback((seed: CardSeed, at: { x: number; y: number }) => {
    const id = nextFilePreview.current++;
    if (seed.draft) keepFrontValue(draftKey(id, seed.path), seed.draft);
    setFilePreviews((current) => [
      ...current,
      {
        id,
        path: seed.path,
        at: null,
        view: seed.view,
        pinned: { at, scale: seed.scale, box: seed.box, collapsed: seed.collapsed },
      },
    ]);
  }, []);

  const closeFilePreview = useCallback((requestId: number) => {
    setFilePreviews((current) => current.filter((preview) => preview.id !== requestId));
  }, []);

  return { filePreviews, openFiles, openPinned, previewFile, closeFilePreview };
}

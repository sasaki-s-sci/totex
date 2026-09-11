import { useFrontState } from "../shell/state";
/**
 * The file cards the window is holding, and the ways one is asked for.
 *
 * A card is opened from a row in the column, from another card, or by dropping
 * a file on the canvas — which is `useNativeDrops`, since a native drop is a
 * point on the window before it is anything else and the canvas is only one of
 * the things that can be under it.
 */

import { useCallback, useRef } from "react";
import { draftKey } from "../components/nodes/preview/draft";
import type { CardSeed } from "../lib/cardWindow";
import { drawn, type FilePreviewRequest, openingView, previewView } from "../lib/filePreview";
import { keepFrontValue } from "../shell/state";

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

  /**
   * Opens a rendering of one file beside the card it is of.
   *
   * One preview to a file: a second press over a card whose file is already
   * being drawn somewhere is answered by the card that is already standing,
   * rather than by another one of it.
   */
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

  /**
   * Takes a card back from a window of its own, pinned at a place in the pane.
   *
   * A card of its own again, under a new id: the one it left with was the old
   * card's, and what was being typed into it is put where the new card's draft
   * will look before the card is placed.
   */
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

import { useCallback, useMemo, useRef } from "react";
import { draftKey } from "../canvas/nodes/preview/draft";
import type { CardSeed } from "../lib/cardWindow";
import {
  drawn,
  type FileDropContext,
  type FilePreviewRequest,
  type FilePreviewView,
  openingView,
  previewView,
} from "../lib/filePreview";
import { frontValue, keepFrontValue, useFrontState } from "../shell/state";

function nextPreview() {
  const id = frontValue<number>("files.nextId") ?? Date.now();
  keepFrontValue("files.nextId", id + 1);
  return id;
}

export function useFileDrops(
  sessionId?: string | null,
  createSession?: (path: string, folder?: string) => string,
) {
  const owner = useRef(sessionId);
  owner.current = sessionId;
  const create = useRef(createSession);
  create.current = createSession;
  const [held, setFilePreviews] = useFrontState<FilePreviewRequest[]>("files.open", []);
  // An earlier version could keep a card in its JSON Schema form, which is gone: it reads as text.
  const filePreviews = useMemo(
    () =>
      held.some((preview) => (preview.view as string | undefined) === "schema")
        ? held.map((preview) =>
            (preview.view as string | undefined) === "schema"
              ? { ...preview, view: "text" as const }
              : preview,
          )
        : held,
    [held],
  );
  // Canonical file panes survive restarts after their opening requests have been consumed.
  keepFrontValue(
    "files.nextId",
    Math.max(
      frontValue<number>("files.nextId") ?? Date.now(),
      ...filePreviews.map((file) => file.id + 1),
    ),
  );

  const openFiles = useCallback(
    (
      paths: readonly string[],
      at: { x: number; y: number } | null,
      folder?: string,
      context?: FileDropContext,
    ) => {
      if (!paths.length) return;
      // Resolve once before queuing updates: one multi-file drop starts only one terminal.
      if (!context?.sessionId && !owner.current) owner.current = create.current?.(paths[0], folder);
      const session = context?.sessionId ?? owner.current ?? undefined;
      setFilePreviews((current) => [
        ...current,
        ...paths.map((path, index) => ({
          id: nextPreview(),
          sessionId: session,
          paneId: context?.paneId,
          replace: context?.replace,
          edge: context?.edge,
          path,
          folder,
          at: at ? { x: at.x + index * 18, y: at.y + index * 18 } : null,
        })),
      ]);
    },
    [],
  );

  // One preview per file: a second press is answered by the card already standing. A view asked
  // for by name is held to that view alone. `again` opens one more whatever stands, to be read
  // against a page that has stopped following the file.
  const previewFile = useCallback(
    (path: string, beside: number, asked?: FilePreviewView, again = false) => {
      const id = nextPreview();
      const view = asked ?? previewView(path);
      setFilePreviews((current) =>
        !again &&
        current.some((preview) => {
          if (preview.path !== path) return false;
          const standing = preview.view ?? openingView(preview.path);
          return asked ? standing === asked : drawn(standing);
        })
          ? current
          : [
              ...current,
              {
                id,
                path,
                at: null,
                view,
                beside,
                folder: current.find((preview) => preview.id === beside)?.folder,
              },
            ],
      );
    },
    [],
  );

  // A new id: the draft is put where the new card looks before it is placed.
  const openPinned = useCallback((seed: CardSeed, at: { x: number; y: number }) => {
    const id = nextPreview();
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

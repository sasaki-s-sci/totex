/**
 * Everything dropped on the window, and where each drop goes.
 *
 * Two things can be dropped on, and the point the drop arrived at is what says
 * which: a folder in the column takes a copy of what was dropped, and the
 * canvas opens it as a card. What is under that point is asked of the document,
 * through the folder each row says it stands for — see `folder/dropInto` —
 * because a native drop does not become a browser drop event in a Tauri
 * webview. What arrives is a point and a list of paths and nothing else.
 *
 * Both drags are held here rather than one each: what is dragged out of
 * Explorer and what is dragged out of a row in the column land in the same
 * folders and are drawn the same way while they are over them, so the folder
 * that is taking one is one answer and not two.
 *
 * A copy every time and never a move. Explorer hands a drop over with the copy
 * cursor on it, and what happens here is not allowed to disagree with what the
 * cursor said: what was dropped stays exactly where it was.
 *
 * Which machine either end is on is not this side's business. A folder inside a
 * WSL distribution is a path like any other here, and the copy into one is made
 * inside the distribution rather than over the share Windows publishes it under
 * — see `fs_browse::copy`, which is where that is decided.
 */

import { getCurrentWindow } from "@tauri-apps/api/window";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { copyInto } from "../folder/api";
import { folderUnder } from "../folder/dropInto";

/** How long a folder that would not take a drop stays marked as having refused
 *  it: long enough to be seen, short enough that nothing has to answer it. */
const REFUSAL_MS = 2400;

/** What the column needs to draw a drop, and the two things it can ask of one. */
export interface Drops {
  /**
   * The folder the drop is going into — while it is still being dragged over,
   * and then while the copy is being made. One answer for both because it is
   * one statement: this is the folder that takes what is being dropped.
   */
  into: string | null;
  /** The folder that would not take what was dropped on it, until it is stale. */
  refused: string | null;
  /** Says which folder a drag is over now, or that it is over none. */
  mark: (into: string | null) => void;
  /** Copies what was dropped into one folder, and says so if it will not go. */
  take: (paths: readonly string[], into: string) => void;
}

export function useDrops(
  main: RefObject<HTMLElement | null>,
  openFiles: (paths: readonly string[], at: { x: number; y: number } | null) => void,
): Drops {
  const [into, setInto] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const forget = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (forget.current) clearTimeout(forget.current);
    },
    [],
  );

  const mark = useCallback((folder: string | null) => setInto(folder), []);

  const take = useCallback((paths: readonly string[], folder: string) => {
    if (paths.length === 0) return;
    // The mark stays on the folder until the copy has been made, which on a
    // folder of any size is the whole of the answer there is to give while it
    // is being made.
    setInto(folder);
    setRefused(null);
    copyInto([...paths], folder)
      .catch(() => {
        // Said by the folder, the way a directory that would not open is said
        // by the rows it does not have: what is missing is the copy, and where
        // it is missing from is the folder it did not land in.
        setRefused(folder);
        if (forget.current) clearTimeout(forget.current);
        forget.current = setTimeout(() => setRefused(null), REFUSAL_MS);
      })
      .finally(() => setInto((held) => (held === folder ? null : held)));
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the ref is the window's own and never changes identity
  useEffect(() => {
    const appWindow = getCurrentWindow();
    let cancelled = false;
    let stop: (() => void) | null = null;
    // Read when a drag arrives rather than at every point of it: the window
    // answers in physical pixels and the document is drawn in CSS ones, and a
    // window does not change screens in the middle of one drag.
    let scale = 1;

    void appWindow
      .onDragDropEvent(async ({ payload }) => {
        if (payload.type === "leave") {
          setInto(null);
          return;
        }
        if (payload.type === "enter") {
          setRefused(null);
          scale = await appWindow.scaleFactor();
          if (cancelled) return;
        }
        const at = { x: payload.position.x / scale, y: payload.position.y / scale };
        const folder = folderUnder(at.x, at.y);
        if (payload.type !== "drop") {
          setInto(folder);
          return;
        }
        if (folder) {
          take(payload.paths, folder);
          return;
        }

        setInto(null);
        // Otherwise the canvas, which opens what it is given. A drop over the
        // column that landed on none of its rows stays the column's: only the
        // canvas takes a card.
        const bounds = main.current?.getBoundingClientRect();
        if (
          payload.paths.length === 0 ||
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
  }, [openFiles, take]);

  return { into, refused, mark, take };
}

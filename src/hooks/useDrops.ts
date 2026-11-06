// A native drop is a point and paths, never a browser drop event; `folder/dropInto` says what is
// under it. Native drops copy; internal drags choose copy or move.

import { getCurrentWindow } from "@tauri-apps/api/window";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { copyInto, moveInto } from "../folder/api";
import { folderUnder } from "../folder/dropInto";
import { dropOnTerminal, terminalUnder } from "../lib/terminalDrop";

const REFUSAL_MS = 2400;

export interface Drops {
  into: string | null;
  refused: string | null;
  mark: (into: string | null) => void;
  take: (paths: readonly string[], into: string, operation?: "copy" | "move") => void;
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

  const take = useCallback(
    (paths: readonly string[], folder: string, operation: "copy" | "move" = "copy") => {
      if (paths.length === 0) return;
      setInto(folder);
      setRefused(null);
      (operation === "move" ? moveInto : copyInto)([...paths], folder)
        .catch(() => {
          setRefused(folder);
          if (forget.current) clearTimeout(forget.current);
          forget.current = setTimeout(() => setRefused(null), REFUSAL_MS);
        })
        .finally(() => setInto((held) => (held === folder ? null : held)));
    },
    [],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: the ref is the window's own and never changes identity
  useEffect(() => {
    const appWindow = getCurrentWindow();
    let cancelled = false;
    let stop: (() => void) | null = null;
    // Scale read once per drag: the window answers in physical pixels, the document in CSS pixels.
    let scale: Promise<number | null> | null = null;
    let latest = 0;

    void appWindow
      .onDragDropEvent(async ({ payload }) => {
        const current = ++latest;
        if (payload.type === "leave") {
          setInto(null);
          return;
        }
        if (payload.type === "enter") {
          setRefused(null);
          scale = appWindow.scaleFactor().catch(() => null);
        }
        // A quick drop can arrive before enter has received the window's scale.
        scale ??= appWindow.scaleFactor().catch(() => null);
        const factor = await scale;
        if (cancelled || factor === null || (payload.type !== "drop" && current !== latest)) return;
        const at = { x: payload.position.x / factor, y: payload.position.y / factor };
        const terminal = terminalUnder(at.x, at.y);
        if (terminal) {
          setInto(null);
          if (payload.type === "drop") dropOnTerminal(terminal, payload.paths);
          return;
        }
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
        // A drop over the column but on no row stays the column's; only the canvas opens a card.
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

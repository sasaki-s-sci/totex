// A native drop is a point and paths, never a browser drop event; `folder/dropInto` says what is
// under it. Native drops copy; internal drags choose copy or move.

import { getCurrentWindow } from "@tauri-apps/api/window";
import { type RefObject, useCallback, useEffect, useRef, useState } from "react";
import { copyInto, moveInto } from "../folder/api";
import { folderUnder } from "../folder/dropInto";
import { type CanvasDrop, canvasDropTarget } from "../lib/canvasDrop";
import {
  type FileDropContext,
  hasFileDrag,
  isLocalFileDrag,
  readFileDrag,
} from "../lib/filePreview";
import { dropFilesOnFrame } from "../lib/frameFileDrop";
import { dropOnTerminal, terminalUnder } from "../lib/terminalDrop";

const REFUSAL_MS = 2400;

export interface Drops {
  into: string | null;
  refused: string | null;
  preview: CanvasDrop | null;
  uploadFailed: boolean;
  clearUploadFailure: () => void;
  mark: (into: string | null) => void;
  take: (paths: readonly string[], into: string, operation?: "copy" | "move") => void;
}

export function useDrops(
  main: RefObject<HTMLElement | null>,
  openFiles: (
    paths: readonly string[],
    at: { x: number; y: number } | null,
    folder?: string,
    context?: FileDropContext,
  ) => void,
): Drops {
  const [into, setInto] = useState<string | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  const [preview, setPreview] = useState<CanvasDrop | null>(null);
  const [uploadFailed, setUploadFailed] = useState(false);
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
    const targetAt = (target: Element | null, at: { x: number; y: number }) =>
      target && (main.current?.contains(target) || target.closest(".layout-bounds"))
        ? canvasDropTarget(target, at)
        : null;
    const frameAt = (target: Element | null) =>
      target instanceof HTMLIFrameElement &&
      target.matches(".canvas-frame") &&
      main.current?.contains(target)
        ? target
        : null;
    const upload = (
      frame: HTMLIFrameElement,
      paths: readonly string[],
      at: { x: number; y: number },
    ) => {
      setUploadFailed(false);
      void dropFilesOnFrame(frame, paths, at).catch(() => {
        if (!cancelled) setUploadFailed(true);
      });
    };
    const showPreview = (next: CanvasDrop | null) =>
      setPreview((before) =>
        before?.host === next?.host && before?.context.edge === next?.context.edge ? before : next,
      );
    const internal = (event: DragEvent) => {
      if (!event.dataTransfer || !hasFileDrag(event.dataTransfer)) return;
      const at = { x: event.clientX, y: event.clientY };
      const target = event.target instanceof Element ? event.target : null;
      const drop = targetAt(target, at);
      const frame = !drop && isLocalFileDrag(event.dataTransfer) ? frameAt(target) : null;
      showPreview(event.type === "drop" ? null : drop);
      if (!drop && !frame) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "copy";
      if (event.type === "drop") {
        const paths = readFileDrag(event.dataTransfer)
          .filter((entry) => !entry.isDir)
          .map((entry) => entry.path);
        if (paths.length) {
          if (drop) openFiles(paths, at, undefined, drop.context);
          else if (frame) upload(frame, paths, at);
        }
      }
    };
    const clear = () => setPreview(null);
    document.addEventListener("dragover", internal, true);
    document.addEventListener("drop", internal, true);
    document.addEventListener("dragleave", clear, true);
    document.addEventListener("dragend", clear, true);

    void appWindow
      .onDragDropEvent(async ({ payload }) => {
        const current = ++latest;
        const owner = main.current?.querySelector("[data-session-canvas]:not([hidden])");
        if (payload.type === "leave") {
          setInto(null);
          setPreview(null);
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
          setPreview(null);
          if (payload.type === "drop") dropOnTerminal(terminal, payload.paths);
          return;
        }
        const folder = folderUnder(at.x, at.y);
        const target = document.elementFromPoint(at.x, at.y);
        const drop = folder ? null : targetAt(target, at);
        showPreview(payload.type === "drop" ? null : drop);
        if (payload.type !== "drop") {
          setInto(folder);
          return;
        }
        if (folder) {
          take(payload.paths, folder);
          return;
        }

        setInto(null);
        if (!payload.paths.length) return;
        if (owner !== main.current?.querySelector("[data-session-canvas]:not([hidden])")) return;
        if (drop) openFiles(payload.paths, at, undefined, drop.context);
        else {
          const frame = frameAt(target);
          if (frame) upload(frame, payload.paths, at);
        }
      })
      .then((unlisten) => {
        if (cancelled) unlisten();
        else stop = unlisten;
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      stop?.();
      document.removeEventListener("dragover", internal, true);
      document.removeEventListener("drop", internal, true);
      document.removeEventListener("dragleave", clear, true);
      document.removeEventListener("dragend", clear, true);
    };
  }, [openFiles, take]);

  return {
    into,
    refused,
    mark,
    take,
    preview,
    uploadFailed,
    clearUploadFailure: () => setUploadFailed(false),
  };
}

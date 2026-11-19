import { Box } from "@mui/material";
import {
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

const KEY_STEP = 16;

type Options = {
  min: number;
  max: number;
  initial: number;
  /**
   * `start` is a grip on the left edge (dragging left widens), `end` on the right (dragging left
   * narrows).
   */
  side: "start" | "end";
  /** A panel unmounted when empty needs this, or every reopen starts at the default. */
  storageKey?: string;
  element: RefObject<HTMLElement | null>;
};

function stored(key: string | undefined, clamp: (width: number) => number, initial: number) {
  if (!key) return initial;
  const held = Number(localStorage.getItem(key));
  return held ? clamp(held) : initial;
}

/**
 * The width is written straight to the element during the drag and handed to React at rest: a
 * pointer reports far more often than a layout is worth.
 */
export function useResizeGrip({ min, max, initial, side, storageKey, element }: Options) {
  const clamp = useCallback((width: number) => Math.min(max, Math.max(min, width)), [max, min]);
  const [width, setWidth] = useState(() => stored(storageKey, clamp, initial));
  const finishResize = useRef<(() => void) | null>(null);

  useEffect(() => () => finishResize.current?.(), []);

  // CSS can cap the panel below its stored width in a narrow window.
  const renderedWidth = useCallback(
    () => (element.current ? Number.parseFloat(getComputedStyle(element.current).width) : width),
    [element, width],
  );

  const remember = useCallback(
    (next: number) => {
      if (element.current) element.current.style.width = `${next}px`;
      setWidth(next);
      if (!storageKey) return;
      try {
        localStorage.setItem(storageKey, String(next));
      } catch {}
    },
    [element, storageKey],
  );

  // A grip on the left edge grows the panel as the pointer goes left.
  const sign = side === "start" ? -1 : 1;

  const startResize = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0 || !event.isPrimary) return;
      event.preventDefault();
      finishResize.current?.();
      const source = event.currentTarget;
      const pointerId = event.pointerId;
      const origin = event.clientX;
      const originWidth = renderedWidth();
      let latest = originWidth;
      const listeners = new AbortController();
      const options = { signal: listeners.signal };

      const finish = () => {
        listeners.abort();
        finishResize.current = null;
        if (source.hasPointerCapture(pointerId)) source.releasePointerCapture(pointerId);
        remember(latest);
      };

      const onMove = (move: globalThis.PointerEvent) => {
        if (move.pointerId !== pointerId) return;
        if (!(move.buttons & 1)) return finish();
        latest = clamp(originWidth + sign * (move.clientX - origin));
        if (element.current) element.current.style.width = `${latest}px`;
      };
      const onEnd = (end: globalThis.PointerEvent) => {
        if (end.pointerId === pointerId) finish();
      };

      // Keep receiving the release over embedded pages and outside the panel.
      source.setPointerCapture(pointerId);
      finishResize.current = finish;
      source.addEventListener("lostpointercapture", onEnd, options);
      window.addEventListener("pointermove", onMove, options);
      window.addEventListener("pointerup", onEnd, options);
      window.addEventListener("pointercancel", onEnd, options);
      window.addEventListener("blur", finish, options);
    },
    [clamp, element, remember, renderedWidth, sign],
  );

  const resizeByKey = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const towards = event.key === "ArrowLeft" ? -1 : 1;
      remember(clamp(renderedWidth() + sign * towards * KEY_STEP));
    },
    [clamp, remember, renderedWidth, sign],
  );

  // One bundle, so the side drawn cannot drift from the side measured.
  return { width, grip: { side, onPointerDown: startResize, onKeyDown: resizeByKey } };
}

type GripProps = {
  label: string;
  side: "start" | "end";
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
};

/** A transparent resize target along the panel's edge. */
export function ResizeGrip({ label, side, onPointerDown, onKeyDown }: GripProps) {
  return (
    <Box
      role="separator"
      tabIndex={0}
      aria-label={label}
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      sx={{
        position: "absolute",
        top: 0,
        ...(side === "start" ? { left: -3 } : { right: -3 }),
        width: 6,
        height: "100%",
        cursor: "col-resize",
        zIndex: 1,
        touchAction: "none",
        userSelect: "none",
        outline: "none",
      }}
    />
  );
}

import { Box } from "@mui/material";
import {
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useCallback,
  useState,
} from "react";

const KEY_STEP = 16;

type Options = {
  min: number;
  max: number;
  initial: number;
  /**
   * `start` is a grip on the left edge (dragging left narrows), `end` on the right (dragging left
   * widens).
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

  const remember = useCallback(
    (next: number) => {
      setWidth(next);
      if (!storageKey) return;
      try {
        localStorage.setItem(storageKey, String(next));
      } catch {}
    },
    [storageKey],
  );

  // A grip on the left edge grows the panel as the pointer goes left.
  const sign = side === "start" ? -1 : 1;

  const startResize = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const origin = event.clientX;
      const originWidth = width;
      let latest = width;

      const onMove = (move: globalThis.PointerEvent) => {
        latest = clamp(originWidth + sign * (move.clientX - origin));
        if (element.current) element.current.style.width = `${latest}px`;
      };
      const onUp = () => {
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        remember(latest);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [clamp, element, remember, sign, width],
  );

  const resizeByKey = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      event.preventDefault();
      const towards = event.key === "ArrowLeft" ? -1 : 1;
      remember(clamp(width + sign * towards * KEY_STEP));
    },
    [clamp, remember, sign, width],
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

/** Only thickens the edge already there: a tinted bar or a focus ring reads as selection. */
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
        userSelect: "none",
        outline: "none",
        "&:hover, &:focus-visible": { bgcolor: "divider" },
      }}
    />
  );
}

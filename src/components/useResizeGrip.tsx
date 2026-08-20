import { Box } from "@mui/material";
import {
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useCallback,
  useState,
} from "react";

/** How far one press of an arrow key moves the edge. */
const KEY_STEP = 16;

type Options = {
  min: number;
  max: number;
  /** The width before anything was dragged, and what a bad stored value falls
   *  back to. */
  initial: number;
  /**
   * Which side of its own element the grip is on.
   *
   * `"start"` is a grip on the left edge, so dragging left narrows the element;
   * `"end"` is a grip on the right edge, where dragging left widens it. The two
   * panels sit either side of the graph and so want opposite signs.
   */
  side: "start" | "end";
  /**
   * Where to remember the width across mounts, or nothing to forget it.
   *
   * A panel that is unmounted whenever it is empty has to be told this, or
   * every session after the first opens at the default.
   */
  storageKey?: string;
  /** The element to size during a drag, which is written to directly. */
  element: RefObject<HTMLElement | null>;
};

function stored(key: string | undefined, clamp: (width: number) => number, initial: number) {
  if (!key) return initial;
  const held = Number(localStorage.getItem(key));
  return held ? clamp(held) : initial;
}

/**
 * A draggable edge, for a panel whose width is the reader's to choose.
 *
 * The width is written straight to the element for the length of the drag and
 * handed to React only where it comes to rest: a pointer reports far more often
 * than a layout is worth, and a panel full of listing rows or terminal lines is
 * an expensive thing to render per pointer event.
 *
 * Both panels in the window use this. What differs between them is the side the
 * grip is on and whether the width outlives the mount, and both are arguments.
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
      } catch {
        // A window that cannot remember the width can still be dragged.
      }
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

  // Handed over as one bundle so that the side the grip is drawn on cannot
  // drift from the side its drag is measured against.
  return { width, grip: { side, onPointerDown: startResize, onKeyDown: resizeByKey } };
}

type GripProps = {
  label: string;
  side: "start" | "end";
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
};

/**
 * The edge itself.
 *
 * The edge that is already there is the affordance, so it only thickens, in the
 * colour it already has. A tinted bar — and the ring the browser puts round a
 * grip that has been clicked — both read as something selected rather than as
 * an edge under the pointer.
 */
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

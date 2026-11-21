import {
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
} from "react";
import { useFrontState } from "../shell/state";
import type { tileLayout } from "./model";
import "./canvasResize.css";

type Axis = "columns" | "rows";
type Sizing = Partial<Record<Axis, number[]>>;
type Options = {
  id: string;
  host: RefObject<HTMLElement | null>;
  layout: ReturnType<typeof tileLayout>;
  enabled: boolean;
  columnLabel: string;
  rowLabel: string;
};

const MIN_SIZE = 96;
const property = { columns: "gridTemplateColumns", rows: "gridTemplateRows" } as const;

function shares(value: unknown, count: number): number[] {
  if (
    Array.isArray(value) &&
    value.length === count &&
    value.every((size) => Number.isFinite(size) && size > 0)
  ) {
    const total = value.reduce((sum, size) => sum + size, 0);
    if (Number.isFinite(total)) return value.map((size) => size / total);
  }
  return Array.from({ length: count }, () => 1 / count);
}

function stored(key: string): Sizing {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function template(weights: number[]): string {
  const minimum = `min(${MIN_SIZE}px, max(0px, calc((100% - ${weights.length - 1}px) / ${weights.length})))`;
  return weights.map((weight) => `minmax(${minimum}, ${weight}fr)`).join(" ");
}

/** Grid-positioned grips follow the tracks without rerendering the pane contents during a drag. */
export function useCanvasResize({ id, host, layout, enabled, columnLabel, rowLabel }: Options) {
  const storageKey = `totex.canvas.sizes.${id}`;
  const [sizing, setSizing] = useFrontState<Sizing>(`canvas.sizes.${id}`, () => stored(storageKey));
  const columns = shares(sizing?.columns, layout.columns);
  const rows = shares(sizing?.rows, layout.rows);
  const style: CSSProperties = {
    gridTemplateColumns: template(columns),
    gridTemplateRows: template(rows),
  };
  const current = useRef({ style, enabled });
  current.current = { style, enabled };
  const finishResize = useRef<((keep: boolean) => void) | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(sizing));
    } catch {}
  }, [storageKey, sizing]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: cancel a gesture when its grid or visibility changes
  useLayoutEffect(
    () => () => finishResize.current?.(false),
    [enabled, layout.columns, layout.rows, layout.cells.length],
  );

  const sizes = (axis: Axis) => {
    const element = host.current;
    if (!element) return null;
    const values = getComputedStyle(element)[property[axis]].split(" ").map(Number.parseFloat);
    return values.length === layout[axis] &&
      values.every((value) => Number.isFinite(value) && value > 0)
      ? values
      : null;
  };
  const remember = (axis: Axis, values: number[]) => {
    const weights = shares(values, values.length);
    if (host.current) host.current.style[property[axis]] = template(weights);
    setSizing((before) => ({ ...before, [axis]: weights }));
  };
  const adjust = (values: number[], boundary: number, delta: number) => {
    const total = values[boundary - 1] + values[boundary];
    const minimum = Math.min(MIN_SIZE, values.reduce((sum, size) => sum + size, 0) / values.length);
    const first = Math.max(minimum, Math.min(total - minimum, values[boundary - 1] + delta));
    return values.map((size, index) =>
      index === boundary - 1 ? first : index === boundary ? total - first : size,
    );
  };
  const apply = (axis: Axis, values: number[]) => {
    if (host.current)
      host.current.style[property[axis]] = values.map((size) => `${size}px`).join(" ");
  };

  const start = (event: PointerEvent<HTMLHRElement>, axis: Axis, boundary: number) => {
    if (!enabled || event.button !== 0 || !event.isPrimary) return;
    event.preventDefault();
    event.stopPropagation();
    finishResize.current?.(false);
    const initial = sizes(axis);
    const element = host.current;
    if (!initial || !element) return;
    const source = event.currentTarget;
    const pointerId = event.pointerId;
    const origin = axis === "columns" ? event.clientX : event.clientY;
    let latest = initial;
    const listeners = new AbortController();
    const options = { signal: listeners.signal };
    const finish = (keep: boolean) => {
      listeners.abort();
      finishResize.current = null;
      delete element.dataset.canvasResizing;
      delete source.dataset.active;
      if (source.hasPointerCapture(pointerId)) source.releasePointerCapture(pointerId);
      if (keep && current.current.enabled) remember(axis, latest);
      else {
        element.style.gridTemplateColumns = String(current.current.style.gridTemplateColumns);
        element.style.gridTemplateRows = String(current.current.style.gridTemplateRows);
      }
    };
    const cancel = () => finish(false);
    source.setPointerCapture(pointerId);
    element.dataset.canvasResizing = axis;
    source.dataset.active = "true";
    finishResize.current = finish;
    source.addEventListener("lostpointercapture", cancel, options);
    window.addEventListener(
      "pointermove",
      (move) => {
        if (move.pointerId !== pointerId) return;
        if (!(move.buttons & 1)) return finish(true);
        latest = adjust(
          initial,
          boundary,
          (axis === "columns" ? move.clientX : move.clientY) - origin,
        );
        apply(axis, latest);
      },
      options,
    );
    window.addEventListener(
      "pointerup",
      (end) => {
        if (end.pointerId === pointerId) finish(true);
      },
      options,
    );
    window.addEventListener(
      "pointercancel",
      (end) => {
        if (end.pointerId === pointerId) cancel();
      },
      options,
    );
    window.addEventListener("blur", cancel, options);
    window.addEventListener("resize", cancel, options);
    window.addEventListener(
      "keydown",
      (key) => {
        if (key.key !== "Escape") return;
        key.preventDefault();
        key.stopImmediatePropagation();
        cancel();
      },
      { ...options, capture: true },
    );
  };

  const byKey = (event: KeyboardEvent<HTMLHRElement>, axis: Axis, boundary: number) => {
    if (!enabled || event.altKey || event.ctrlKey || event.metaKey) return;
    const before = axis === "columns" ? "ArrowLeft" : "ArrowUp";
    const after = axis === "columns" ? "ArrowRight" : "ArrowDown";
    if (![before, after, "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    event.stopPropagation();
    finishResize.current?.(false);
    const values = sizes(axis);
    if (!values) return;
    const step = event.shiftKey ? 48 : 16;
    const delta =
      event.key === "Home"
        ? -Infinity
        : event.key === "End"
          ? Infinity
          : event.key === before
            ? -step
            : step;
    const next = adjust(values, boundary, delta);
    apply(axis, next);
    remember(axis, next);
  };

  const grip = (axis: Axis, boundary: number, row = 0) => {
    const weights = axis === "columns" ? columns : rows;
    return (
      <hr
        key={`${axis}-${boundary}-${row}`}
        className="canvas-resize-grip"
        data-canvas-resize={axis}
        data-boundary={boundary}
        data-row={row}
        tabIndex={0}
        aria-label={`${axis === "columns" ? columnLabel : rowLabel} ${boundary}`}
        aria-orientation={axis === "columns" ? "vertical" : "horizontal"}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(
          (100 * weights[boundary - 1]) / (weights[boundary - 1] + weights[boundary]),
        )}
        style={
          axis === "columns"
            ? {
                gridColumn: `${boundary + 1} / ${boundary + 2}`,
                gridRow: `${row + 1} / ${row + 2}`,
              }
            : { gridColumn: "1 / -1", gridRow: `${boundary + 1} / ${boundary + 2}` }
        }
        onPointerDown={(event) => start(event, axis, boundary)}
        onKeyDown={(event) => byKey(event, axis, boundary)}
      />
    );
  };
  const grips = enabled
    ? [
        ...layout.cells
          .filter((cell) => cell.column > 0)
          .map((cell) => grip("columns", cell.column, cell.row)),
        ...Array.from({ length: layout.rows - 1 }, (_, row) => grip("rows", row + 1)),
      ]
    : [];
  return { style, grips };
}

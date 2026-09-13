import type { NodeChange } from "@xyflow/react";
import { useSyncExternalStore } from "react";
import { settingsNow, subscribeSettings } from "./appSettings";

export const GRID = { least: 1, most: 100, start: 24 } as const;

/** One notch past the widest spacing reads as no grid at all. */
export const GRID_OFF = GRID.most + 1;

export type Least = { width: number; height: number };

export function gridNow(): { step: number; holding: boolean } {
  const { gridStep, gridSnap } = settingsNow();
  return { step: gridStep, holding: gridSnap };
}

export function useGrid(): { step: number; holding: boolean } {
  return useSyncExternalStore(subscribeSettings, gridNow, gridNow);
}

export function onGrid(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/** Never below the least a card may be: the smallest size rounds up, not down. */
export function sizeOnGrid(value: number, step: number, least: number): number {
  return Math.max(onGrid(value, step), Math.ceil(least / step) * step);
}

export function upToGrid(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

export function placeOnGrid(
  position: { x: number; y: number },
  box: { width: number; height: number },
  step: number,
  least: Least,
): { position: { x: number; y: number }; box: { width: number; height: number } } {
  return {
    position: { x: onGrid(position.x, step), y: onGrid(position.y, step) },
    box: {
      width: sizeOnGrid(box.width, step, least.width),
      height: sizeOnGrid(box.height, step, least.height),
    },
  };
}

/** Only sizes an edge set are rounded; a folded card's measured bar height stays. */
export function heldToGrid<Change extends NodeChange>(
  changes: readonly Change[],
  leastOf: (id: string) => Least | null,
  step: number,
): Change[] {
  return changes.map((change) => {
    if (change.type !== "position" && change.type !== "dimensions") return change;
    const least = leastOf(change.id);
    if (!least) return change;
    if (change.type === "position") {
      if (!change.position) return change;
      const position = { x: onGrid(change.position.x, step), y: onGrid(change.position.y, step) };
      return { ...change, position, positionAbsolute: position };
    }
    if (!change.dimensions || !change.setAttributes) return change;
    const { width, height } = change.dimensions;
    const across = change.setAttributes === true || change.setAttributes === "width";
    const down = change.setAttributes === true || change.setAttributes === "height";
    return {
      ...change,
      dimensions: {
        width: across ? sizeOnGrid(width, step, least.width) : width,
        height: down ? sizeOnGrid(height, step, least.height) : height,
      },
    };
  });
}

/**
 * The grid behind the canvas, and what is held to it.
 *
 * The lines are drawn a set distance apart, and that distance is the one thing
 * about them a hand can change: a fine grid for laying cards edge to edge, a
 * coarse one for a canvas read from across the room. A file card can be held
 * to the same lines — where its corner stands and how wide and tall it is are
 * all multiples of the spacing — so that cards put down near one another line
 * up without being nudged into it. Only file cards: the graph is dealt onto a
 * grid of its own (see `lib/graph/grid`), and a folder carried somewhere lands
 * on that one.
 *
 * Stored in the application settings document alongside theme and language.
 */

import type { NodeChange } from "@xyflow/react";
import { useSyncExternalStore } from "react";
import { settingsNow, subscribeSettings } from "./appSettings";

/** The room the spacing has, and what a window that has never been told uses. */
export const GRID = { least: 8, most: 96, start: 24 } as const;

/** How far apart the spacings offered are: every one of them divides the
 *  start, so the grid a card was held to is still a grid it stands on. */
export const GRID_STEP = 8;

/** The smallest a card may be, which a snapped size is never taken below. */
export type Least = { width: number; height: number };

/** The grid as the settings page shows it: how far apart, and whether cards
 *  are held to it. */
export function gridNow(): { step: number; holding: boolean } {
  const { gridStep, gridSnap } = settingsNow();
  return { step: gridStep, holding: gridSnap };
}

export function useGrid(): { step: number; holding: boolean } {
  return useSyncExternalStore(subscribeSettings, gridNow, gridNow);
}

/** The nearest line to a point along one axis. */
export function onGrid(value: number, step: number): number {
  return Math.round(value / step) * step;
}

/**
 * The nearest whole number of steps to a length, and never fewer than fit the
 * least the card may be: a card dragged to its smallest is rounded up to the
 * line beyond it rather than down past what the edge would have allowed.
 */
export function sizeOnGrid(value: number, step: number, least: number): number {
  return Math.max(onGrid(value, step), Math.ceil(least / step) * step);
}

/** The first line at or past a length: for a width that was measured, so that
 *  what was measured still fits. */
export function upToGrid(value: number, step: number): number {
  return Math.ceil(value / step) * step;
}

/** A card's corner and box, both held to the grid. */
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

/**
 * The canvas's changes with every card among them held to the grid.
 *
 * A drag reports where the card now stands and an edge dragged reports how big
 * it now is, each worked out afresh from where the pointer is rather than from
 * the last change, so rounding every one of them is a card that moves a line
 * at a time and never drifts. Only what an edge set is rounded: a card folded
 * away has no height of its own, and the one the canvas measured for its bar
 * is left as it was measured.
 */
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

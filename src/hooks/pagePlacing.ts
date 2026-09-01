/**
 * Where a page stands on the canvas, and what carries it.
 *
 * A file's card and the settings page are placed the same way — see `Page` for
 * the panel the two of them are drawn in. They open in the middle of what is
 * being shown, or wherever they were dropped, and React Flow owns where they
 * are from then on.
 */

import type { Edge, ReactFlowInstance } from "@xyflow/react";
import type { AppNode } from "../lib/graph";

/**
 * The layer every page stands on.
 *
 * A page is opened onto the graph, not into it: whatever it is over, it is the
 * thing being read. React Flow draws a node nested in another a step above the
 * one it sits in, so a repository's own marks came out over a card left
 * standing on the band. Well clear of that stack of steps.
 */
export const PAGE_Z = 1_100;

/** What a page is dragged by. Its bar, which is the one part of it that is
 *  neither something to read nor something to press — see `Page`. */
export const PAGE_HANDLE = ".page__header";

/** Where the bar lands: a page opens hanging from the point it was asked for
 *  rather than centred on it, so that what was under the pointer is what the
 *  page is now held by. */
const BAR = 17;

/** The middle of what the canvas is showing, in screen pixels. A pane that has
 *  not been measured yet stands in its own page's size, which opens the page at
 *  the corner rather than nowhere at all. */
export function canvasMiddle(
  bounds: DOMRect | undefined,
  box: { width: number; height: number },
  nudge = 0,
): { x: number; y: number } {
  return {
    x: (bounds?.left ?? 0) + (bounds?.width ?? box.width) / 2 + nudge,
    y: (bounds?.top ?? 0) + (bounds?.height ?? box.height) / 2 + nudge,
  };
}

/** The corner a page of this size is placed at to hang from a point on screen,
 *  in the canvas's own coordinates. */
export function pageCorner(
  flow: ReactFlowInstance<AppNode, Edge>,
  screen: { x: number; y: number },
  box: { width: number; height: number },
): { x: number; y: number } {
  const point = flow.screenToFlowPosition(screen);
  return { x: point.x - box.width / 2, y: point.y - BAR };
}

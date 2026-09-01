/**
 * What a turn of the wheel does to the canvas.
 *
 * React Flow's own answer is d3-zoom's: the point under the cursor is held
 * still, so the graph slides towards whatever the pointer happens to be resting
 * on. On a canvas the size of a workspace that reads as the same gesture doing
 * something different every time — the wheel turned the same way twice, from
 * two places the cursor was left, leaves two different views, and neither of
 * them is the one that was being looked at. So the wheel is answered here
 * instead, about the middle of the pane: what the canvas comes in on is what is
 * in front of the eye, wherever the pointer is.
 *
 * A pinch is left to React Flow. It arrives as a wheel with Ctrl held, but it
 * is a gesture with a place in it — two fingers closing somewhere — and holding
 * that place still is what it means. Only the wheel is answered here, which is
 * the one that has no place of its own.
 */

import type { Edge, ReactFlowInstance } from "@xyflow/react";
import { type RefObject, useEffect } from "react";
import type { AppNode } from "../lib/graph";
import { MAX_ZOOM, MIN_ZOOM } from "./useCanvasFold";

/**
 * What a wheel event's delta is worth, in powers of two, for each of the three
 * units a browser reports one in — pixels, lines and pages.
 *
 * d3-zoom's own numbers, taken rather than picked: the wheel is being answered
 * somewhere else now, not turned into a different gesture, and how far a step
 * of it takes the canvas should be exactly what it was.
 */
const PER_PIXEL = 0.002;
const PER_LINE = 0.05;
const PER_PAGE = 1;
/** How a browser says which of the three it is reporting. */
const IN_LINES = 1;

export type ZoomCanvas = {
  /** The React Flow wrapper, which is the pane the middle is measured from and
   *  the element the wheel is heard on — the same one d3 would have heard it
   *  on, so nothing outside the canvas answers to this. */
  pane: RefObject<HTMLDivElement | null>;
  instance: RefObject<ReactFlowInstance<AppNode, Edge> | null>;
};

export function useCanvasZoom({ pane, instance }: ZoomCanvas) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: the refs are the canvas's own and never change identity
  useEffect(() => {
    const canvas = pane.current;
    if (!canvas) return;

    const turn = (event: WheelEvent) => {
      // A pinch is React Flow's, and so is a wheel over a page that scrolls its
      // own body — `nowheel` is the class React Flow reads to leave those
      // alone, and it is read here for the same reason.
      if (event.ctrlKey) return;
      if (event.target instanceof Element && event.target.closest(".nowheel")) return;

      const flow = instance.current;
      const box = canvas.getBoundingClientRect();
      if (!flow || box.width === 0 || box.height === 0) return;

      event.preventDefault();
      const step = event.deltaMode === IN_LINES ? PER_LINE : event.deltaMode ? PER_PAGE : PER_PIXEL;
      const view = flow.getViewport();
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * 2 ** (-event.deltaY * step)));
      if (zoom === view.zoom) return;

      // The middle of the pane names a point on the graph, and that point is
      // what the new view is built around: the canvas is translated so it lands
      // back where it was, which leaves everything else growing out of it.
      const by = zoom / view.zoom;
      const middle = { x: box.width / 2, y: box.height / 2 };
      flow.setViewport({
        zoom,
        x: middle.x - (middle.x - view.x) * by,
        y: middle.y - (middle.y - view.y) * by,
      });
    };

    // Not passive: the page would otherwise scroll under the canvas, and the
    // canvas is the whole window.
    canvas.addEventListener("wheel", turn, { passive: false });
    return () => canvas.removeEventListener("wheel", turn);
  }, []);
}

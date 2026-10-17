import type { Edge, ReactFlowInstance } from "@xyflow/react";
import { type RefObject, useEffect } from "react";
import type { AppNode } from "../../lib/graph";
import { wheelFactor } from "../../lib/wheel";
import { MAX_ZOOM, MIN_ZOOM } from "./useCanvasFold";

const PER_PIXEL = 0.002;
const PER_LINE = 0.05;
const PER_PAGE = 1;

const IN_LINES = 1;
const PINCH = 10;

export type ZoomCanvas = {
  pane: RefObject<HTMLDivElement | null>;
  instance: RefObject<ReactFlowInstance<AppNode, Edge> | null>;
};

// Only Ctrl+wheel (and a pinch) zooms, about the cursor wherever it is, over a card's own wheel too.
// A plain wheel no longer zooms or scrolls the canvas.
export function useCanvasZoom({ pane, instance }: ZoomCanvas) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: the refs are the canvas's own and never change identity
  useEffect(() => {
    const canvas = pane.current;
    if (!canvas) return;

    const zoomBy = (event: WheelEvent, about: (box: DOMRect) => { x: number; y: number }) => {
      const flow = instance.current;
      const box = canvas.getBoundingClientRect();
      if (!flow || box.width === 0 || box.height === 0) return;

      event.preventDefault();
      const step = event.deltaMode === IN_LINES ? PER_LINE : event.deltaMode ? PER_PAGE : PER_PIXEL;
      const turned = -event.deltaY * step * PINCH * wheelFactor("graph");
      const view = flow.getViewport();
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * 2 ** turned));
      if (zoom === view.zoom) return;

      const by = zoom / view.zoom;
      const point = about(box);
      flow.setViewport({
        zoom,
        x: point.x - (point.x - view.x) * by,
        y: point.y - (point.y - view.y) * by,
      });
    };

    // Captured, so a terminal or a preview under the cursor never sees it. d3-zoom's pinch is ten times a wheel's.
    const pinch = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.stopPropagation();
      zoomBy(event, (box) => ({ x: event.clientX - box.left, y: event.clientY - box.top }));
    };

    // Not passive: the page would scroll under the canvas, and Ctrl would scale the whole window.
    canvas.addEventListener("wheel", pinch, { capture: true, passive: false });
    return () => {
      canvas.removeEventListener("wheel", pinch, { capture: true });
    };
  }, []);
}

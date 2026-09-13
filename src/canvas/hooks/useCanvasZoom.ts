import type { Edge, ReactFlowInstance } from "@xyflow/react";
import { type RefObject, useEffect } from "react";
import type { AppNode } from "../../lib/graph";
import { wheelFactor } from "../../lib/wheel";
import { MAX_ZOOM, MIN_ZOOM } from "./useCanvasFold";

const PER_PIXEL = 0.002;
const PER_LINE = 0.05;
const PER_PAGE = 1;

const IN_LINES = 1;

export type ZoomCanvas = {
  pane: RefObject<HTMLDivElement | null>;
  instance: RefObject<ReactFlowInstance<AppNode, Edge> | null>;
};

// Zooms about the pane's middle rather than d3-zoom's cursor point; a pinch (wheel with Ctrl) stays React Flow's.
export function useCanvasZoom({ pane, instance }: ZoomCanvas) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: the refs are the canvas's own and never change identity
  useEffect(() => {
    const canvas = pane.current;
    if (!canvas) return;

    const turn = (event: WheelEvent) => {
      if (event.ctrlKey) return;
      // nowheel is the class React Flow reads to leave a scrolling page alone.
      if (event.target instanceof Element && event.target.closest(".nowheel")) return;

      const flow = instance.current;
      const box = canvas.getBoundingClientRect();
      if (!flow || box.width === 0 || box.height === 0) return;

      event.preventDefault();
      const step = event.deltaMode === IN_LINES ? PER_LINE : event.deltaMode ? PER_PAGE : PER_PIXEL;
      const turned = -event.deltaY * step * wheelFactor("graph");
      const view = flow.getViewport();
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * 2 ** turned));
      if (zoom === view.zoom) return;

      const by = zoom / view.zoom;
      const middle = { x: box.width / 2, y: box.height / 2 };
      flow.setViewport({
        zoom,
        x: middle.x - (middle.x - view.x) * by,
        y: middle.y - (middle.y - view.y) * by,
      });
    };

    // Not passive: the page would scroll under the canvas.
    canvas.addEventListener("wheel", turn, { passive: false });
    return () => canvas.removeEventListener("wheel", turn);
  }, []);
}

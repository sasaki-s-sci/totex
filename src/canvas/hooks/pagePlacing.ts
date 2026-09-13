import type { Edge, ReactFlowInstance } from "@xyflow/react";
import type { AppNode } from "../../lib/graph";

// Well above React Flow's per-nesting z steps, so a page is never under a band's own marks.
export const PAGE_Z = 1_100;

export const PAGE_HANDLE = ".page__header";

const BAR = 17;

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

export function pageCorner(
  flow: ReactFlowInstance<AppNode, Edge>,
  screen: { x: number; y: number },
  box: { width: number; height: number },
): { x: number; y: number } {
  const point = flow.screenToFlowPosition(screen);
  return { x: point.x - box.width / 2, y: point.y - BAR };
}

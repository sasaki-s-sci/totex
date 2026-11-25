import { dropEdge, type Edge } from "../canvas/layout";
import type { FileDropContext } from "./filePreview";

type Point = { x: number; y: number };

export type CanvasDrop = { context: FileDropContext; host: Element };

export function canvasDropTarget(target: Element | null, at: Point): CanvasDrop | null {
  if (target?.closest(".canvas-header-space")) {
    const canvas = target
      .closest("main")
      ?.querySelector<HTMLElement>("[data-session-canvas]:not([hidden])");
    return {
      context: { sessionId: canvas?.dataset.sessionCanvas, replace: false },
      host: canvas ?? target,
    };
  }
  const miniature = target?.closest<HTMLElement>(".layout-bounds");
  const canvas =
    miniature?.querySelector<HTMLElement>(".layout-map") ??
    target?.closest<HTMLElement>("[data-session-canvas]") ??
    target?.closest<HTMLElement>(".terminal-canvases");
  if (!canvas) return null;
  const sessionId = miniature ? canvas.dataset.layoutCanvas : canvas.dataset.sessionCanvas;
  if (!sessionId) return { context: {}, host: canvas };
  const selector = miniature ? "[data-layout-pane]" : "[data-canvas-pane]";
  // Divider handles sit above pane edges, so resolve the pane underneath by position too.
  const pane =
    target?.closest<HTMLElement>(selector) ??
    [...canvas.querySelectorAll<HTMLElement>(`:scope > ${selector}`)].find((element) => {
      const rect = element.getBoundingClientRect();
      return (
        at.x >= rect.left - 1 &&
        at.x <= rect.right + 1 &&
        at.y >= rect.top - 1 &&
        at.y <= rect.bottom + 1
      );
    });
  const expanded = pane?.querySelector("dialog[open]");
  const edgeAt = (element: Element, band: number): Edge | null => {
    const rect = element.getBoundingClientRect();
    return dropEdge(at.x - rect.left, at.y - rect.top, rect.width, rect.height, band);
  };
  const outerEdge =
    !expanded && ((miniature && edgeAt(miniature, 4)) || edgeAt(canvas, miniature ? 4 : 24));
  if (outerEdge) return { context: { sessionId, edge: outerEdge }, host: canvas };
  const host = expanded ?? pane ?? canvas;
  const edge = pane ? (edgeAt(host, miniature ? 12 : 24) ?? undefined) : undefined;
  return {
    context: {
      sessionId,
      paneId: miniature ? pane?.dataset.layoutPane : pane?.dataset.canvasPane,
      replace: !edge,
      edge,
    },
    host,
  };
}

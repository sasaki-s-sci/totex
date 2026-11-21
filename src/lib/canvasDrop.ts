import type { FilePreviewRequest } from "./filePreview";

type Point = { x: number; y: number };

export function canvasDropContext(
  target: Element | null,
): Pick<FilePreviewRequest, "sessionId" | "paneId"> {
  return {
    sessionId: target?.closest<HTMLElement>("[data-session-canvas]")?.dataset.sessionCanvas,
    paneId: target?.closest<HTMLElement>("[data-canvas-pane]")?.dataset.canvasPane,
  };
}

/** Occupied pages keep their center for application interaction. */
export function isPreviewDrop(target: Element | null, at: Point): boolean {
  const pane = target?.closest<HTMLElement>("[data-canvas-pane]");
  if (!pane) return !!target?.closest(".session-canvas, .canvas-empty, .canvas-window-drag");
  if (pane.dataset.canvasKind === "empty") return true;
  const bounds = (pane.querySelector("dialog[open]") ?? pane).getBoundingClientRect();
  const edge = Math.min(24, bounds.width / 4, bounds.height / 4);
  return (
    at.x >= bounds.left &&
    at.x <= bounds.right &&
    at.y >= bounds.top &&
    at.y <= bounds.bottom &&
    Math.min(at.x - bounds.left, bounds.right - at.x, at.y - bounds.top, bounds.bottom - at.y) <=
      edge
  );
}

export function canvasUploadFrame(target: Element | null): HTMLIFrameElement | null {
  return target instanceof HTMLIFrameElement &&
    target.matches(".canvas-frame") &&
    target.closest('[data-canvas-kind="iframe"]')
    ? target
    : null;
}

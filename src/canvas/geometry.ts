import type { Rectangle } from "./layout";

export function canvasGeometry(canvas: Element) {
  const bounds = canvas.getBoundingClientRect();
  const panes: Record<string, Rectangle> = Object.create(null);
  const elements = [...canvas.querySelectorAll<HTMLElement>(":scope > [data-canvas-pane]")];
  if (bounds.width && bounds.height) {
    for (const pane of elements) {
      const rect = pane.getBoundingClientRect();
      panes[pane.dataset.canvasPane ?? ""] = {
        left: (rect.left - bounds.left) / bounds.width,
        top: (rect.top - bounds.top) / bounds.height,
        width: rect.width / bounds.width,
        height: rect.height / bounds.height,
      };
    }
  }
  return { aspect: bounds.width / bounds.height || 1, panes, elements };
}

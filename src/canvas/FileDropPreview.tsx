import { createPortal } from "react-dom";
import type { CanvasDrop } from "../lib/canvasDrop";

export function FileDropPreview({ drop }: { drop: CanvasDrop | null }) {
  if (!drop) return null;
  const edge = drop.context.edge;
  return createPortal(
    <div
      className="canvas-drop-preview"
      aria-hidden
      data-edge={edge}
      style={{
        left: edge === "right" ? "50%" : 0,
        top: edge === "bottom" ? "50%" : 0,
        width: edge === "left" || edge === "right" ? "50%" : "100%",
        height: edge === "top" || edge === "bottom" ? "50%" : "100%",
      }}
    />,
    drop.host,
  );
}

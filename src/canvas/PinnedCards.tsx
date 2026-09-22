import { useEffect, useRef } from "react";
import type { FilePreviewFlowNode } from "../lib/graph";
import { PageSlot } from "../page/PageWorkspace";
import { filePageId } from "../page/placement";
import { fileSize } from "./hooks/useFilePreviews";
import type { usePinDrag } from "./hooks/usePinDrag";

/** A layer over the whole pane that lets the pointer through; only the cards answer. */
export function PinnedCards({
  pinnedFiles,
  pinDrag,
}: {
  pinnedFiles: readonly FilePreviewFlowNode[];
  pinDrag: ReturnType<typeof usePinDrag>;
}) {
  if (pinnedFiles.length === 0) return null;

  return (
    <div className="graph__pinned">
      {pinnedFiles.map((node) => {
        const box = fileSize(node);
        return (
          <PinnedCard
            key={node.id}
            requestId={node.data.requestId}
            pinDrag={pinDrag}
            className="graph__pin"
            style={{
              left: node.data.pinnedAt?.x,
              top: node.data.pinnedAt?.y,
              width: box.width,
              transform: `scale(${node.data.pinnedScale ?? 1})`,
              transformOrigin: "top left",

              height: node.data.collapsed ? undefined : box.height,
            }}
          >
            <PageSlot id={filePageId(node.data.requestId)} place="pinned" />
          </PinnedCard>
        );
      })}
    </div>
  );
}

function PinnedCard({
  requestId,
  pinDrag,
  ...props
}: React.ComponentProps<"div"> & { requestId: number; pinDrag: ReturnType<typeof usePinDrag> }) {
  const ref = useRef<HTMLDivElement>(null);
  const { onPointerDown, onPointerMove, onPointerUp } = pinDrag;
  // Native bubbling follows the physical host, including a page rendered through a portal.
  useEffect(() => {
    const host = ref.current;
    if (!host) return;
    const down = (event: PointerEvent) => onPointerDown(event, requestId);
    host.addEventListener("pointerdown", down);
    host.addEventListener("pointermove", onPointerMove);
    host.addEventListener("pointerup", onPointerUp);
    host.addEventListener("pointercancel", onPointerUp);
    return () => {
      host.removeEventListener("pointerdown", down);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerup", onPointerUp);
      host.removeEventListener("pointercancel", onPointerUp);
    };
  }, [requestId, onPointerDown, onPointerMove, onPointerUp]);
  return <div {...props} ref={ref} />;
}

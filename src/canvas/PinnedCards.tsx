import type { FilePreviewFlowNode } from "../lib/graph";
import { fileSize } from "./hooks/useFilePreviews";
import type { usePinDrag } from "./hooks/usePinDrag";
import { FilePreviewCard } from "./nodes/FilePreviewNode";

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
          <div
            key={node.id}
            className="graph__pin"
            onPointerDown={(event) => pinDrag.onPointerDown(event, node.data.requestId)}
            onPointerMove={pinDrag.onPointerMove}
            onPointerUp={pinDrag.onPointerUp}
            onPointerCancel={pinDrag.onPointerUp}
            style={{
              left: node.data.pinnedAt?.x,
              top: node.data.pinnedAt?.y,
              width: box.width,
              transform: `scale(${node.data.pinnedScale ?? 1})`,
              transformOrigin: "top left",

              height: node.data.collapsed ? undefined : box.height,
            }}
          >
            <FilePreviewCard data={node.data} />
          </div>
        );
      })}
    </div>
  );
}

/**
 * The cards that have been pinned off the canvas, drawn over it.
 *
 * The layer itself is the whole pane and lets everything through — what answers
 * on it is the cards, and the graph underneath answers for the rest, so a
 * pinned card costs the canvas around it nothing.
 */

import { fileSize } from "../hooks/useFilePreviews";
import type { usePinDrag } from "../hooks/usePinDrag";
import type { FilePreviewFlowNode } from "../lib/graph";
import { FilePreviewCard } from "./nodes/FilePreviewNode";

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
              // Put away, a card is as tall as its header, which is
              // the header's own answer and not a number kept here.
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

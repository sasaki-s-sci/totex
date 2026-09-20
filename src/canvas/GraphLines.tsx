import { ViewportPortal, type XYPosition } from "@xyflow/react";
import { memo, useMemo } from "react";
import type { AppNode, Band, CommitFlowNode, Hold } from "../lib/graph";
import { Bands, type Batch, Reach } from "./lines/bands";
import { CommitEmphasis, Hover } from "./lines/hover";
import { CommitMessages } from "./lines/messages";

/** Every line as a handful of batched paths: one element per commit was most of a frame's cost. */
export const GraphLines = memo(function GraphLines({
  bands,
  reach,
  holds,
  extent,
  nodes,
  selected,
  picked,
  reading,
  onCommit,
}: {
  bands: readonly Band[];

  reach: readonly Batch[];

  holds: readonly Hold[];

  extent: { width: number; height: number };
  nodes: readonly AppNode[];
  selected: string | null;
  picked: string | null;

  reading: boolean;

  onCommit: (node: CommitFlowNode, at: { x: number; y: number }) => void;
}) {
  const standing = useMemo(() => {
    const places = new Map<string, XYPosition>();
    for (const node of nodes) places.set(node.id, node.position);
    return places;
  }, [nodes]);

  return (
    <ViewportPortal>
      {/* An SVG root clips to its own box whatever overflow says, so it is sized to the extent. */}
      <svg className="graph__lines" width={extent.width} height={extent.height} aria-hidden="true">
        <Reach reach={reach} standing={standing} />
        <Bands bands={bands} standing={standing} />
        {reading && <CommitMessages bands={bands} standing={standing} />}
        <CommitEmphasis
          bands={bands}
          standing={standing}
          selected={selected}
          picked={picked}
          onCommit={onCommit}
        />
        <Hover
          bands={bands}
          holds={holds}
          standing={standing}
          selected={selected}
          onCommit={onCommit}
        />
      </svg>
    </ViewportPortal>
  );
});

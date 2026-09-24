import { ViewportPortal, type XYPosition } from "@xyflow/react";
import { memo, useMemo } from "react";
import type { AppNode, Band, CommitFlowNode, Hold } from "../lib/graph";
import { CHANGE_COLOUR, useChanges } from "./changes";
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
  offering,
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

  /** Ctrl+Shift is held: the lines into the offers are drawn with them. */
  offering: boolean;

  reading: boolean;

  onCommit: (node: CommitFlowNode, at: { x: number; y: number }) => void;
}) {
  const standing = useMemo(() => {
    const places = new Map<string, XYPosition>();
    for (const node of nodes) places.set(node.id, node.position);
    return places;
  }, [nodes]);

  const changes = useChanges();
  // By the node a line ends on: the ring's colour is run back along the line into it, and a
  // repository's up the line from the folder above it.
  const tints = useMemo(() => {
    const tinted: Map<string, string> = new Map();
    for (const node of nodes) {
      const change =
        node.type === "head"
          ? node.data.cwd !== null
            ? changes.worktrees.get(node.data.cwd)
            : undefined
          : node.type === "repository"
            ? changes.repositories.get(node.id)
            : node.type === "repo-mark"
              ? changes.repositories.get(node.data.repository.id)
              : undefined;
      if (change) tinted.set(node.id, CHANGE_COLOUR[change]);
    }
    return tinted;
  }, [nodes, changes]);

  return (
    <ViewportPortal>
      {/* An SVG root clips to its own box whatever overflow says, so it is sized to the extent. */}
      <svg className="graph__lines" width={extent.width} height={extent.height} aria-hidden="true">
        <Reach reach={reach} standing={standing} tints={tints} />
        <Bands bands={bands} standing={standing} offering={offering} tints={tints} />
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

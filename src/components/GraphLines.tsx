import { ViewportPortal, type XYPosition } from "@xyflow/react";
import { memo, useMemo } from "react";
import type { AppNode, Band, CommitFlowNode } from "../lib/graph";
import { Bands, type Batch, Reach } from "./lines/bands";
import { CommitEmphasis, Hover } from "./lines/hover";

/**
 * Every line on the canvas, drawn as a handful of paths.
 *
 * History is lines, and there are as many of them as there are commits — the
 * canvas routinely holds a thousand. Given to the engine one element apiece
 * they were the greater part of what a frame cost, so they are batched instead:
 * every line a band draws the same way is one path with a piece per line, and a
 * repository comes to about a dozen elements however long its history is.
 *
 * The band's own lines are worked out once and held in its own coordinates, so
 * a repository moving — its folder carried across the canvas, a repository above
 * it opening out — is a different `translate` on the same paths.
 *
 * Nothing here takes the pointer. What a line offers is drawn only while the
 * cursor is on it, by `Hover`, which finds the line by arithmetic rather than
 * by asking the engine to hit-test a thousand of them.
 */
export const GraphLines = memo(function GraphLines({
  bands,
  reach,
  extent,
  nodes,
  selected,
  picked,
  onCommit,
}: {
  bands: readonly Band[];
  /**
   * The lines that belong to no band: what each folder holds, and what is
   * running in the rows a folder draws.
   */
  reach: readonly Batch[];
  /**
   * The box the lines are drawn in, which is as big as everything reaches.
   *
   * Handed over rather than worked out here: an SVG root clips to its own box
   * whatever it is told about overflow, and what hangs lowest on the canvas is
   * a band of places the repositories know nothing about.
   */
  extent: { width: number; height: number };
  nodes: readonly AppNode[];
  selected: string | null;
  picked: string | null;
  onCommit: (node: CommitFlowNode, at: { x: number; y: number }) => void;
}) {
  // Where every mark is standing, which is where the lines into it are drawn
  // from. The canvas's own copy rather than the layout's: a repository laid out
  // again walks its commits to their new places over a few frames, and the
  // lines have to walk with them.
  const standing = useMemo(() => {
    const places = new Map<string, XYPosition>();
    for (const node of nodes) places.set(node.id, node.position);
    return places;
  }, [nodes]);

  return (
    <ViewportPortal>
      <svg className="graph__lines" width={extent.width} height={extent.height} aria-hidden="true">
        {/* Under the history, and drawn on the canvas rather than in any band:
            these are the one kind of line that runs from one repository to
            another, and what they cross is not theirs to obscure. */}
        <Reach reach={reach} standing={standing} />
        <Bands bands={bands} standing={standing} />
        <CommitEmphasis
          bands={bands}
          standing={standing}
          selected={selected}
          picked={picked}
          onCommit={onCommit}
        />
        <Hover bands={bands} standing={standing} selected={selected} onCommit={onCommit} />
      </svg>
    </ViewportPortal>
  );
});

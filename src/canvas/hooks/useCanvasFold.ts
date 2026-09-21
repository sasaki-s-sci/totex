import {
  type Edge,
  getViewportForBounds,
  type ReactFlowInstance,
  type Viewport,
  type XYPosition,
} from "@xyflow/react";
import { type RefObject, useCallback, useEffect, useRef } from "react";
import { type AppNode, commitNodeId, type GraphResult, isPage } from "../../lib/graph";
import { reconcile } from "../../lib/graph/reconcile";
import { centreOf } from "../../lib/graphNav";
import type { Workspace } from "../../types/git";
import type { useHistoryDepth } from "./useHistoryDepth";

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 5;

const FIT_PADDING = 0.1;

const RETURN_MS = 200;

export type FoldCanvas = {
  workspace: Workspace;
  graph: GraphResult;

  applied: RefObject<GraphResult | null>;
  standing: RefObject<readonly AppNode[]>;
  host: RefObject<HTMLDivElement | null>;
  instance: RefObject<ReactFlowInstance<AppNode, Edge> | null>;
  setNodes: (update: (current: AppNode[]) => AppNode[]) => void;
  glide: (from: Map<string, XYPosition>, to: readonly AppNode[]) => void;
  depth: ReturnType<typeof useHistoryDepth>;
};

export function useCanvasFold({
  workspace,
  graph,
  applied,
  standing,
  host,
  instance,
  setNodes,
  glide,
  depth,
}: FoldCanvas) {
  const { reaching, expand: expandDepth, fold: foldDepth, reach, keep } = depth;

  const pinned = useRef<{ id: string; at: XYPosition } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the refs are the canvas's own and never change identity
  const pin = useCallback(
    (repository: string) => {
      const entry = workspace.repositories.find((candidate) => candidate.id === repository);
      const tip = entry?.commits[0];
      if (!entry || !tip) return;
      const id = commitNodeId(entry, tip.id);
      pinned.current = standing.current.some((node) => node.id === id)
        ? { id, at: centreOf(standing.current, id) }
        : null;
    },
    [workspace.repositories],
  );

  // History is laid out oldest first, so revealing a fold shifts every commit; the viewport is walked by the same amount to keep the newest commit still.
  const expand = useCallback(
    (repository: string) => {
      pin(repository);
      expandDepth(repository);
    },
    [expandDepth, pin],
  );

  const fold = useCallback(
    (repository: string, shown: number) => {
      pin(repository);
      foldDepth(repository, shown);
    },
    [foldDepth, pin],
  );

  // From the build's extent rather than fitView: React Flow's store only has this frame's nodes next frame.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the refs are the canvas's own and never change identity
  const standBack = useCallback((extent: { width: number; height: number }) => {
    const flow = instance.current;
    const pane = host.current?.getBoundingClientRect();
    if (!flow || !pane || pane.width === 0 || pane.height === 0) return;
    if (extent.width <= 0 || extent.height <= 0) return;
    flow.setViewport(
      getViewportForBounds(
        { x: 0, y: 0, width: extent.width, height: extent.height },
        pane.width,
        pane.height,
        MIN_ZOOM,
        MAX_ZOOM,
        FIT_PADDING,
      ),
    );
  }, []);

  // Taken on the pull's first frame; the canvas moves every frame after.
  const beforeReach = useRef<Viewport | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the refs are the canvas's own and never change identity
  const reachFold = useCallback(
    (repository: string, shown: number | null) => {
      if (shown === null) {
        const was = beforeReach.current;
        beforeReach.current = null;
        reach(repository, null);
        if (was) instance.current?.setViewport(was, { duration: RETURN_MS });
        return;
      }

      beforeReach.current ??= instance.current?.getViewport() ?? null;
      reach(repository, shown);
    },
    [reach],
  );

  const keepFold = useCallback(
    (repository: string) => {
      beforeReach.current = null;
      keep(repository);
    },
    [keep],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: the refs are the canvas's own and never change identity
  useEffect(() => {
    // Only what the last change moved is walked; the rest keeps React Flow's measured nodes.
    const before = applied.current;
    applied.current = graph;
    const from = new Map(standing.current.map((node) => [node.id, node.position] as const));
    setNodes((current) => {
      const pages = current.filter(isPage);
      const history = current.filter((node) => !isPage(node));
      const merged = reconcile(history, graph.nodes, before?.nodes, (rebuilt, holding) => ({
        ...rebuilt,
        selected: holding.selected,
        measured: holding.measured,
      }));
      return [...merged, ...pages];
    });

    if (reaching) {
      pinned.current = null;
      standBack(graph.extent);
      return;
    }

    const held = pinned.current;
    pinned.current = null;
    const view = held ? instance.current?.getViewport() : undefined;
    if (held && view && graph.nodes.some((node) => node.id === held.id)) {
      const now = centreOf(graph.nodes, held.id);
      instance.current?.setViewport({
        ...view,
        x: view.x - (now.x - held.at.x) * view.zoom,
        y: view.y - (now.y - held.at.y) * view.zoom,
      });
      return;
    }

    glide(from, graph.nodes);
  }, [graph, setNodes, glide, reaching, standBack]);

  return { expand, fold, setLength: foldDepth, reachFold, keepFold, standBack };
}

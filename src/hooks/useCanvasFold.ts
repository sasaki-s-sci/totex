/**
 * How the canvas answers a fold, an expand and a pull.
 *
 * All three lay a band out from a different end — the history is drawn oldest
 * first, so revealing what was behind a fold gives every commit already on the
 * canvas a column further along. None of that is a reason for the graph to move
 * under whoever asked for it, so the canvas is walked by the same amount
 * instead and the newest commit is left exactly where it was.
 */

import {
  type Edge,
  getViewportForBounds,
  type ReactFlowInstance,
  type Viewport,
  type XYPosition,
} from "@xyflow/react";
import { type RefObject, useCallback, useEffect, useRef } from "react";
import { type AppNode, commitNodeId, type GraphResult } from "../lib/graph";
import { reconcile } from "../lib/graph/reconcile";
import { centreOf } from "../lib/graphNav";
import type { Workspace } from "../types/git";
import type { useHistoryDepth } from "./useHistoryDepth";

/**
 * How far the canvas may be taken, either way.
 *
 * Far enough out to hold a workspace of long histories — a pull standing the
 * canvas back to fit one runs into this and no sooner — and far enough in for a
 * commit to be a thing rather than a dot.
 */
export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 5;
/** The share of the pane left round what is framed, which is `fitView`'s own. */
const FIT_PADDING = 0.1;
/** How long the canvas takes to come back from a pull that asked for nothing. */
const RETURN_MS = 200;

export type FoldCanvas = {
  workspace: Workspace;
  graph: GraphResult;
  /** The graph React Flow is showing, which the next one is built against. */
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

  /**
   * A mark to hold still across the next rebuild, and where it is standing now.
   *
   * Folding and expanding are the one thing that lays a band out from a
   * different end: the history is drawn oldest first, so revealing what was
   * behind the fold gives every commit already on the canvas a column further
   * along, and the band grows into its neighbours. None of that is a reason for
   * the graph to move under whoever asked for it, so the canvas is walked by
   * the same amount instead and the newest commit is left exactly where it was.
   */
  const pinned = useRef<{ id: string; at: XYPosition } | null>(null);

  /**
   * Holds the newest commit of a repository still: the end a history is read
   * from, and the one mark a fold or an expand can never take away.
   *
   * Measured against what is standing on screen rather than against the graph
   * as built, so a fold asked for mid-walk holds the mark where the eye has it.
   */
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

  /**
   * Stands the canvas back far enough to hold the whole of what is drawn.
   *
   * Worked out from the extent the build measured rather than by asking React
   * Flow to fit its own nodes: a fit is a pass over the store, and the store is
   * handed this frame's nodes after this frame — waiting for that is what
   * `FIT_DELAY_MS` is, and a pull cannot spend it eighty times. The extent is
   * the same box the lines are given, and it is already in hand.
   */
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

  /**
   * Where the canvas was standing when the pull began.
   *
   * A pull let go where it started asked for nothing, and a canvas left
   * standing back from a graph that never changed would be the one thing such a
   * gesture had left behind. So it is put back, over a moment rather than at
   * once: the band closing up and the canvas coming in are the same movement
   * undone, and a jump would read as a third thing having happened.
   */
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
      // Taken on the first frame of the pull and held for the whole of it: the
      // canvas moves on every frame after that, and what it is being put back
      // to is where it was before any of them.
      beforeReach.current ??= instance.current?.getViewport() ?? null;
      reach(repository, shown);
    },
    [reach],
  );

  const keepFold = useCallback(
    (repository: string) => {
      // Nothing to put back: the canvas is standing where the pull left it, and
      // what it is looking at is exactly what was asked for.
      beforeReach.current = null;
      keep(repository);
    },
    [keep],
  );

  // Only what the last workspace change actually moved is handed over; a
  // repository that stayed put keeps the nodes React Flow already measured,
  // selected and drew. What did move is walked there rather than put there.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the refs are the canvas's own and never change identity
  useEffect(() => {
    const before = applied.current;
    applied.current = graph;
    const from = new Map(standing.current.map((node) => [node.id, node.position] as const));
    setNodes((current) => {
      const files = current.filter((node) => node.type === "file-preview");
      const history = current.filter((node) => node.type !== "file-preview");
      const merged = reconcile(history, graph.nodes, before?.nodes, (rebuilt, holding) => ({
        ...rebuilt,
        selected: holding.selected,
        measured: holding.measured,
      }));
      return [...merged, ...files];
    });

    // A pull is under way, and the band it is in was laid out again for this
    // very frame of it. Nothing is walked and nothing is held still: what is
    // drawn is what the hand is asking for, the fold it is on stays at the
    // column it has always been at, and the history runs out to the right of it
    // — which is a band that is wider every frame. The canvas takes that by
    // standing back far enough to hold the whole of what is now drawn.
    if (reaching) {
      pinned.current = null;
      standBack(graph.extent);
      return;
    }

    // A fold or an expand: the canvas takes the whole of the move, so nothing
    // on it appears to have moved at all — the history that arrives comes in
    // from the side, and the commit under the cursor stays under the cursor.
    // Nothing is walked here either: a walk is how a node says it is the same
    // node somewhere else, and none of them are anywhere else.
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

  return { expand, fold, reachFold, keepFold, standBack };
}

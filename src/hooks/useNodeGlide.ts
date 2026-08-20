import type { XYPosition } from "@xyflow/react";
import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef } from "react";

import type { AppNode } from "../lib/graph";

/**
 * How long a node takes to walk to where it now belongs.
 *
 * Long enough for the eye to follow one node across the move, short enough that
 * it is never waited on: expanding history moves most of a repository at once,
 * and anything slower reads as the canvas being redrawn rather than as the
 * things on it moving.
 */
const GLIDE_MS = 240;

/**
 * Walks nodes to their new places instead of putting them there.
 *
 * Folding history, expanding it, a repository arriving — each of these lays the
 * whole band out again, and every node in it lands somewhere else. Cut between
 * the two, the graph reads as a different graph: what the eye was on is gone and
 * has to be found again. Moving over a few frames says it is the same commit,
 * and it is now over there.
 *
 * The positions React Flow holds are what moves, not a CSS transition on the
 * nodes — the lines are drawn from those positions, so a node that slid without
 * them would leave its history behind and snap back to it at the end.
 */
export function useNodeGlide(setNodes: Dispatch<SetStateAction<AppNode[]>>) {
  const frame = useRef(0);

  // A move in flight when the canvas goes away has nowhere to land.
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  return useCallback(
    /**
     * @param from Where each node was standing, by id: whatever is on screen
     *   now, which for a node caught mid-move is where it had got to.
     * @param to The graph that has just been handed over, which is where they
     *   all belong.
     */
    (from: ReadonlyMap<string, XYPosition>, to: readonly AppNode[]) => {
      cancelAnimationFrame(frame.current);
      if (still()) return;

      const moving = new Map<string, { from: XYPosition; to: XYPosition }>();
      for (const node of to) {
        const was = from.get(node.id);
        // Nothing to walk from: a node that has just appeared is drawn where it
        // belongs, the way it would be on the first frame of the whole canvas.
        if (!was) continue;
        if (was.x === node.position.x && was.y === node.position.y) continue;
        moving.set(node.id, { from: was, to: node.position });
      }
      if (moving.size === 0) return;

      const walk = (at: number) =>
        setNodes((current) =>
          current.map((node) => {
            const move = moving.get(node.id);
            if (!move) return node;
            return {
              ...node,
              position: {
                x: move.from.x + (move.to.x - move.from.x) * at,
                y: move.from.y + (move.to.y - move.from.y) * at,
              },
            };
          }),
        );

      // Back to the start in the same render the new graph was applied in, so
      // there is no frame of everything already being where it is going.
      walk(0);

      const started = performance.now();
      const step = () => {
        const elapsed = Math.min(1, (performance.now() - started) / GLIDE_MS);
        // Eased at both ends rather than away-and-decaying: a node that leaves
        // at speed is a node that has already gone by the time the eye finds
        // it, and following one across the move is the whole point.
        walk(elapsed * elapsed * (3 - 2 * elapsed));
        if (elapsed < 1) frame.current = requestAnimationFrame(step);
      };
      frame.current = requestAnimationFrame(step);
    },
    [setNodes],
  );
}

/** Whether this machine has asked for as little movement as possible. */
function still(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

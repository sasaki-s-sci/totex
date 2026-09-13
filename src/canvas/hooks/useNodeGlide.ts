import type { XYPosition } from "@xyflow/react";
import { type Dispatch, type SetStateAction, useCallback, useEffect, useRef } from "react";

import type { AppNode } from "../../lib/graph";

const GLIDE_MS = 240;

export function useNodeGlide(setNodes: Dispatch<SetStateAction<AppNode[]>>) {
  const frame = useRef(0);

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  // Moves React Flow's own positions rather than a CSS transition: the lines are drawn from those positions.
  return useCallback(
    (from: ReadonlyMap<string, XYPosition>, to: readonly AppNode[]) => {
      cancelAnimationFrame(frame.current);
      if (still()) return;

      const moving = new Map<string, { from: XYPosition; to: XYPosition }>();
      for (const node of to) {
        const was = from.get(node.id);

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

      walk(0);

      const started = performance.now();
      const step = () => {
        const elapsed = Math.min(1, (performance.now() - started) / GLIDE_MS);

        walk(elapsed * elapsed * (3 - 2 * elapsed));
        if (elapsed < 1) frame.current = requestAnimationFrame(step);
      };
      frame.current = requestAnimationFrame(step);
    },
    [setNodes],
  );
}

function still(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

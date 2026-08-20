import type { Edge, ReactFlowInstance } from "@xyflow/react";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AppNode } from "../lib/graph";
import { first, type Pickable, pickables, step } from "../lib/graphNav";

const DIRECTIONS: Record<string, { x: number; y: number }> = {
  ArrowRight: { x: 1, y: 0 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

/** How close to the edge of the pane a picked node may be before it is panned to. */
const MARGIN = 72;
const PAN_MS = 180;

type Options = {
  nodes: readonly AppNode[];
  instance: RefObject<ReactFlowInstance<AppNode, Edge> | null>;
  host: RefObject<HTMLDivElement | null>;
  /** Do to a node what clicking it would. */
  activate: (node: AppNode) => void;
};

/**
 * Walking the graph with the cursor keys, while Ctrl is held.
 *
 * Held rather than toggled: the graph is a canvas, and the arrows belong to it
 * only for as long as something says so. Let go and the pick goes with it, so
 * there is no mode to be left in and nothing to press to get out.
 *
 * The pick is written straight onto the node's own element rather than fed back
 * through the graph. Every node would otherwise be rebuilt to move a ring from
 * one of them to another — the graph is thousands of them, and none of the rest
 * changed.
 */
export function useGraphKeys({ nodes, instance, host, activate }: Options) {
  const [picked, setPicked] = useState<string | null>(null);
  // The listeners are registered once and read through this, so a graph that
  // changes underneath them does not cost a pair of listeners each time.
  const latest = useRef({ nodes, activate });
  latest.current = { nodes, activate };
  // Where every node can be landed on, rebuilt only when the graph itself is.
  // A held arrow key repeats far faster than the canvas changes, and walking
  // every node twice per repeat is the bulk of what a walk would cost.
  const picks = useMemo(() => pickables(nodes), [nodes]);
  const index = useRef(picks);
  index.current = picks;
  const at = useRef<string | null>(null);

  /** Brings a pick into view, but only when it is not already there. */
  const reveal = useCallback(
    (pick: Pickable) => {
      const flow = instance.current;
      const box = host.current?.getBoundingClientRect();
      if (!flow || !box) return;

      const { x, y, zoom } = flow.getViewport();
      const onScreen = { x: pick.x * zoom + x, y: pick.y * zoom + y };
      const inside =
        onScreen.x >= MARGIN &&
        onScreen.y >= MARGIN &&
        onScreen.x <= box.width - MARGIN &&
        onScreen.y <= box.height - MARGIN;
      if (inside) return;

      flow.setCenter(pick.x, pick.y, { zoom, duration: PAN_MS });
    },
    [host, instance],
  );

  useEffect(() => {
    const drop = () => {
      at.current = null;
      setPicked(null);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      // Ctrl is what lends the arrows to the graph; a terminal or a text field
      // keeps its own keys either way.
      if (!event.ctrlKey || typing(event.target)) return;

      const direction = DIRECTIONS[event.key];
      if (direction) {
        event.preventDefault();
        const picks = index.current;
        const from = picks.find((pick) => pick.id === at.current);
        const next = from ? step(from, picks, direction) : first(picks);
        if (!next) return;
        at.current = next.id;
        setPicked(next.id);
        reveal(next);
        return;
      }

      if (event.key === "Enter" && at.current) {
        event.preventDefault();
        const node = latest.current.nodes.find((candidate) => candidate.id === at.current);
        if (node) latest.current.activate(node);
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Control") drop();
    };

    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    // A window that loses focus never sees the key come back up.
    window.addEventListener("blur", drop);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", drop);
    };
  }, [reveal]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a redrawn graph is what loses the mark, so it is the trigger
  useEffect(() => {
    const element = host.current;
    if (!element) return;

    for (const marked of element.querySelectorAll(".is-picked")) {
      marked.classList.remove("is-picked");
    }
    if (!picked) return;

    const mark = () =>
      element
        .querySelector(`.react-flow__node[data-id="${CSS.escape(picked)}"]`)
        ?.classList.add("is-picked");
    mark();
    // A node that was off screen is drawn only once the pan has reached it.
    const timer = setTimeout(mark, PAN_MS + 80);
    return () => clearTimeout(timer);
  }, [picked, nodes, host]);

  return picked;
}

/** Whether the keys belong to something being typed into. */
function typing(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement
  );
}

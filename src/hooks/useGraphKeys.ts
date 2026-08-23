import type { Edge, ReactFlowInstance } from "@xyflow/react";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CliJumps } from "../components/cliJumps";
import type { AppNode } from "../lib/graph";
import { first, jumpable, type Pickable, pickables, step } from "../lib/graphNav";

const DIRECTIONS: Record<string, { x: number; y: number }> = {
  ArrowRight: { x: 1, y: 0 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

/** How close to the edge of the pane a picked node may be before it is panned to. */
const MARGIN = 72;
const PAN_MS = 180;

/**
 * How long a number stays open to a second digit.
 *
 * Past ten terminals a number is two keys, and the second one has to arrive
 * while the first still means something — otherwise a 1 typed a minute ago
 * would turn a later 2 into the twelfth terminal. Long enough to be typed
 * rather than raced, short enough that two separate jumps in one hold of Ctrl
 * are two jumps.
 */
const RUN_MS = 700;

type Options = {
  nodes: readonly AppNode[];
  instance: RefObject<ReactFlowInstance<AppNode, Edge> | null>;
  host: RefObject<HTMLDivElement | null>;
  /** Do to a node what clicking it would. */
  activate: (node: AppNode) => void;
  /** Go to a terminal that was asked for by number: it goes in the panel. */
  jump: (node: AppNode) => void;
};

/**
 * Walking the graph with the cursor keys, while Ctrl is held — and reaching a
 * terminal by its number, which is what the same key puts on them.
 *
 * Held rather than toggled: the graph is a canvas, and the arrows belong to it
 * only for as long as something says so. Let go and the pick goes with it, so
 * there is no mode to be left in and nothing to press to get out. The numbers
 * come and go with it for the same reason — they are drawn while they can be
 * used, and never a moment longer.
 *
 * The pick is written straight onto the node's own element rather than fed back
 * through the graph. Every node would otherwise be rebuilt to move a ring from
 * one of them to another — the graph is thousands of them, and none of the rest
 * changed.
 */
export function useGraphKeys({ nodes, instance, host, activate, jump }: Options) {
  const [picked, setPicked] = useState<string | null>(null);
  // Whether Ctrl is down, which is the whole of what puts the numbers on the
  // terminals. Only the marks read it, so it costs a render of those and
  // nothing else.
  const [holding, setHolding] = useState(false);
  // The listeners are registered once and read through this, so a graph that
  // changes underneath them does not cost a pair of listeners each time.
  const latest = useRef({ nodes, activate, jump });
  latest.current = { nodes, activate, jump };
  // Where every node can be landed on, rebuilt only when the graph itself is.
  // A held arrow key repeats far faster than the canvas changes, and walking
  // every node twice per repeat is the bulk of what a walk would cost.
  const picks = useMemo(() => pickables(nodes), [nodes]);
  const index = useRef(picks);
  index.current = picks;
  // The terminals in the order the numbers are given out in, and the numbers
  // themselves. The same list read both ways: what a key lands on, and what
  // each mark draws while the key that lands on it is down.
  const stacks = useMemo(() => jumpable(nodes), [nodes]);
  const places = useRef(stacks);
  places.current = stacks;
  const numbers = useMemo(
    () => new Map(stacks.map((stack, place) => [stack.id, place + 1])),
    [stacks],
  );
  const at = useRef<string | null>(null);
  /** The number being typed, and when its last digit arrived. */
  const typed = useRef<{ number: number; at: number } | null>(null);

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
      typed.current = null;
      setPicked(null);
      setHolding(false);
    };

    /**
     * The terminal a digit asks for, which is the one wearing that number.
     *
     * A digit typed straight after another is read as the second of a pair
     * first — the tenth terminal is a 1 and then a 0 — and falls back to being
     * a number of its own when no terminal is wearing what the pair comes to.
     * So a window with nine terminals in it never waits for a second digit, and
     * one with thirty answers 3 and then 1 with the thirty-first if there is
     * one and with the third if there is not.
     */
    const jumpTo = (digit: number) => {
      const stacks = places.current;
      const running = typed.current;
      const carried = running && Date.now() - running.at < RUN_MS ? running.number * 10 + digit : 0;
      const wanted = carried >= 1 && carried <= stacks.length ? carried : digit;
      if (wanted < 1 || wanted > stacks.length) {
        typed.current = null;
        return;
      }

      typed.current = { number: wanted, at: Date.now() };
      const stack = stacks[wanted - 1];
      // Where the arrows would carry on from, so a jump is somewhere to walk
      // out of rather than a place the walk has never heard of.
      at.current = stack.id;
      setPicked(stack.id);
      reveal(stack);
      const node = latest.current.nodes.find((candidate) => candidate.id === stack.id);
      if (node) latest.current.jump(node);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey) return;
      // Ctrl is what numbers the terminals, wherever the window is being typed
      // into: the jump is how one terminal is left for another, so it has to
      // answer from inside the terminal being left.
      setHolding(true);

      // A number, with nothing else held: the same key the terminal is told to
      // leave alone, so that the one press is answered once and here.
      if (numeric(event) && !event.altKey && !event.metaKey) {
        event.preventDefault();
        // A held key is one press. Left to repeat, a number would read its own
        // repeats as the digits after it and walk away down the stack.
        if (!event.repeat) jumpTo(Number(event.key));
        return;
      }

      // The arrows and Return are the graph's only while nothing else is being
      // typed: a terminal or a text field keeps its own keys either way.
      if (typing(event.target)) return;

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

  const jumps: CliJumps = holding ? numbers : null;
  return { picked, jumps };
}

/** One of the ten keys a terminal can be reached by. */
function numeric(event: KeyboardEvent): boolean {
  return event.key.length === 1 && event.key >= "0" && event.key <= "9";
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

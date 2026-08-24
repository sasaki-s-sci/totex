import type { Edge, ReactFlowInstance } from "@xyflow/react";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CliJumps } from "../components/cliJumps";
import type { AppNode } from "../lib/graph";
import { first, history, jumpable, type Pickable, pickables, step } from "../lib/graphNav";

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
  /** Go to a terminal the walk reached or a number named: it goes in the panel. */
  jump: (node: AppNode) => void;
  /**
   * What the walk has arrived at, which is not the same as what it is holding.
   *
   * The ring goes when Ctrl does, and a commit is not a node the canvas keeps
   * anything about — so the one lasting thing a walk does is said here, and the
   * window keeps it.
   */
  land: (node: AppNode | null) => void;
  /**
   * What the window has already picked out, which is where a walk carries on
   * from when it has not walked yet.
   *
   * A commit clicked with the mouse is where the eye is, and a first arrow that
   * left it for the top corner of the canvas would be a walk starting over
   * rather than a walk carrying on.
   */
  selected: string | null;
};

/**
 * Walking the window with the cursor keys while Ctrl is held: the terminals on
 * their own, and — with Shift held as well — the canvas they are standing on.
 *
 * Ctrl and an arrow steps from terminal to terminal, and Ctrl and a number goes
 * straight to the one wearing it. Both leave the panel holding what they
 * reached, so the two of them are one way of getting about rather than a walk
 * and a jump apiece — and the arrows answer from inside a terminal for the same
 * reason the numbers already did: leaving one is what they are for.
 *
 * Ctrl and Shift and an arrow is the other walk, and it is a walk along the
 * history: commit to commit, past everything else standing on the canvas.
 * Nothing is opened by being reached out there — what the walk finds is picked
 * out where it stands, and Return is what opens it.
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
export function useGraphKeys({ nodes, instance, host, activate, jump, land, selected }: Options) {
  const [picked, setPicked] = useState<string | null>(null);
  // Whether Ctrl is down, which is the whole of what puts the numbers on the
  // terminals. Only the marks read it, so it costs a render of those and
  // nothing else.
  const [holding, setHolding] = useState(false);
  // The terminal the panel is holding, which is where a walk between terminals
  // sets out from before it has walked anywhere of its own. Read off the graph
  // rather than asked of the panel: the mark drawn as the one being shown is the
  // one the eye is on, and it is already here.
  const shown = useMemo(
    () => nodes.find((node) => node.type === "cli" && node.data.showing)?.id ?? null,
    [nodes],
  );
  // The listeners are registered once and read through this, so a graph that
  // changes underneath them does not cost a pair of listeners each time.
  const latest = useRef({ nodes, activate, jump, land, selected, shown });
  latest.current = { nodes, activate, jump, land, selected, shown };
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
  // The history, which is the whole of what the walk with Shift held walks
  // along. Kept apart from the pick list above it because that one is every
  // node on the canvas: it is what a walk is standing on, rather than what
  // either walk is a walk through.
  const trail = useMemo(() => history(nodes), [nodes]);
  const along = useRef(trail);
  along.current = trail;
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
      latest.current.land(node ?? null);
      if (node) latest.current.jump(node);
    };

    /**
     * A step of a walk, from wherever the last one left off.
     *
     * The terminals are walked on their own and the history is walked with
     * Shift, but either walk sets out from where the other one stopped — which
     * is why what it is standing on is looked up in every node on the canvas
     * rather than in what is being walked. A walk between terminals that begins
     * at a commit begins at that commit's place on the canvas, and finds the
     * terminal nearest it from there.
     */
    const walk = (direction: { x: number; y: number }, terminals: boolean) => {
      const among = terminals ? places.current : along.current;
      // Where the walk is, or failing that where the eye is: the terminal the
      // panel is holding, or a commit that has been picked out already.
      const standing =
        at.current ?? (terminals ? latest.current.shown : null) ?? latest.current.selected;
      const from = index.current.find((pick) => pick.id === standing);
      const next = from ? step(from, among, direction) : first(among);
      if (!next) return;

      at.current = next.id;
      // A digit typed before the walk named somewhere the walk has since left.
      typed.current = null;
      setPicked(next.id);
      reveal(next);
      const node = latest.current.nodes.find((candidate) => candidate.id === next.id) ?? null;
      latest.current.land(node);
      // Reaching a terminal is going to it: the panel comes back holding what
      // the walk arrived at, the same as a number would have left it.
      if (terminals && node) latest.current.jump(node);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      // Ctrl, and nothing beside it. Alt and the window key are somebody else's
      // shortcut, and none of this is worth taking one of those apart for.
      if (!event.ctrlKey || event.altKey || event.metaKey) return;
      // Ctrl is what numbers the terminals, wherever the window is being typed
      // into: the jump is how one terminal is left for another, so it has to
      // answer from inside the terminal being left.
      setHolding(true);

      // A number: the same key the terminal is told to leave alone, so that the
      // one press is answered once and here.
      if (numeric(event)) {
        event.preventDefault();
        // A held key is one press. Left to repeat, a number would read its own
        // repeats as the digits after it and walk away down the stack.
        if (!event.repeat) jumpTo(Number(event.key));
        return;
      }

      const direction = DIRECTIONS[event.key];
      if (direction) {
        // A terminal is walked out of from inside it, the same way it is left
        // by a number. Anything else being typed into keeps its own arrows:
        // there they move a cursor through what is written, and there is
        // nothing in a field of text to walk away from.
        if (typing(event.target) && !terminal(event.target)) return;
        event.preventDefault();
        walk(direction, !event.shiftKey);
        return;
      }

      // Return is the graph's only while nothing at all is being typed into:
      // out here it opens what the walk found, and in a terminal it is the line
      // that has just been typed.
      if (typing(event.target)) return;

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

/**
 * Whether the keys are being typed into a terminal.
 *
 * Which is a textarea like any other as far as the window can see — xterm reads
 * what is typed through a hidden one — so the arrows are told the difference
 * between the thing they are for leaving and a field of text they would be
 * taken out of.
 */
function terminal(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && target.closest(".xterm") !== null;
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

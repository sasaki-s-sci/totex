import type { Edge, ReactFlowInstance } from "@xyflow/react";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CliJumps } from "../components/cliJumps";
import { type AppNode, commitNodeId } from "../lib/graph";
import { first, history, jumpable, type Pickable, pickables, step } from "../lib/graphNav";
import { terminal, typing } from "../lib/keys";

const DIRECTIONS: Record<string, { x: number; y: number }> = {
  ArrowRight: { x: 1, y: 0 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

/** How close to the edge of the pane a picked node may be before it is panned to. */
const MARGIN = 72;
const PAN_MS = 180;

/** How long a number stays open to a second digit: long enough to be typed
 *  rather than raced, short enough that two jumps in one hold are two jumps. */
const RUN_MS = 700;

type Options = {
  nodes: readonly AppNode[];
  instance: RefObject<ReactFlowInstance<AppNode, Edge> | null>;
  host: RefObject<HTMLDivElement | null>;
  /** Do to a node what clicking it would. */
  activate: (node: AppNode) => void;
  /** Go to a terminal the walk reached or a number named: it goes in the panel. */
  jump: (node: AppNode) => void;
  /** End a terminal the walk is standing on: the shell stops, and the mark
   *  drawn for it leaves the canvas with it. */
  end: (node: AppNode) => void;
  /** What the walk has arrived at, which the window keeps: the ring itself goes
   *  when Ctrl does. */
  land: (node: AppNode | null) => void;
  /** What the window has already picked out, which is where a walk that has not
   *  walked yet carries on from: a clicked commit is where the eye is. */
  selected: string | null;
};

/**
 * Walking the window with the cursor keys while Ctrl is held.
 *
 * Ctrl and an arrow steps from terminal to terminal and Ctrl and a number goes
 * straight to the one wearing it; both leave the panel holding what they
 * reached. Ctrl and Shift and an arrow is the other walk, along the history —
 * nothing is opened out there, and Return is what opens it. Ctrl and D ends the
 * terminal the walk is standing on, which is the one key here that takes
 * something away rather than going to it.
 *
 * Held rather than toggled: let go and the pick goes with it, so there is no
 * mode to be left in. The pick is written straight onto the node's own element
 * rather than fed back through the graph, which would rebuild every node.
 */
export function useGraphKeys({
  nodes,
  instance,
  host,
  activate,
  jump,
  end,
  land,
  selected,
}: Options) {
  const [picked, setPicked] = useState<string | null>(null);
  // Whether Ctrl is down, which is the whole of what puts the numbers on the
  // terminals. Only the marks read it, so it costs a render of those and
  // nothing else.
  const [holding, setHolding] = useState(false);
  // Where a walk between terminals sets out from before it has walked anywhere
  // of its own. Read off the graph: the mark drawn as being shown is already here.
  const shown = useMemo(
    () => nodes.find((node) => node.type === "cli" && node.data.showing)?.id ?? null,
    [nodes],
  );
  // A history walk starts on the real commit pointed at by the workspace whose
  // terminal is open. The workspace node itself is not a duplicate commit.
  const shownCommit = useMemo(() => {
    const cli = nodes.find((node) => node.type === "cli" && node.data.showing);
    if (cli?.type !== "cli" || !cli.parentId) return null;
    const { parentId } = cli;
    const cwd = cli.data.session.cwd;
    const head = nodes.find(
      (node) => node.type === "head" && node.parentId === parentId && node.data.cwd === cwd,
    );
    if (head?.type !== "head") return null;
    const target =
      head.data.kind === "worktree"
        ? head.data.repository.worktrees.find((worktree) => worktree.path === cwd)?.head
        : head.data.repository.branches.find(
            (branch) => branch.kind === head.data.kind && branch.name === head.data.name,
          )?.commit;
    return target ? commitNodeId(head.data.repository, target) : null;
  }, [nodes]);
  // The listeners are registered once and read through this, so a graph that
  // changes underneath them does not cost a pair of listeners each time.
  const latest = useRef({ nodes, activate, jump, end, land, selected, shown, shownCommit });
  latest.current = { nodes, activate, jump, end, land, selected, shown, shownCommit };
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
  // What the walk with Shift held walks along, kept apart from the pick list
  // above it: that one is every node on the canvas.
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

    /** The terminal a digit asks for. A digit typed straight after another is
     *  read as the second of a pair first, and falls back to a number of its own
     *  when no terminal is wearing what the pair comes to. */
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

    /** A step of a walk, from wherever the last one left off — either walk sets
     *  out from where the other stopped, which is why what it is standing on is
     *  looked up in every node rather than in what is being walked. */
    const walk = (direction: { x: number; y: number }, terminals: boolean) => {
      const among = terminals ? places.current : along.current;
      // The first history press chooses its origin. Later presses walk from it.
      const beginning =
        terminals || at.current
          ? null
          : ((latest.current.shownCommit
              ? among.find((pick) => pick.id === latest.current.shownCommit)
              : null) ?? first(among));
      // Where the walk is, or failing that where the eye is: the terminal the
      // panel is holding, or a commit that has been picked out already.
      const standing =
        at.current ?? (terminals ? latest.current.shown : null) ?? latest.current.selected;
      const from = index.current.find((pick) => pick.id === standing);
      const next = beginning ?? (from ? step(from, among, direction) : first(among));
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

      // D: the terminal the walk is standing on is ended, shell and mark
      // together. Only ever the one the walk found — with nothing picked out
      // the press is left where it has always gone, which in a shell is the end
      // of what is being read, and a key that sometimes closed whatever the
      // panel happened to be holding would end a session mid-line. The shell
      // being ended sees the ^D as well: to stop that, every terminal would
      // have to give up its EOF for a press that only ever arrives at one that
      // is going anyway.
      if (event.key.toLowerCase() === "d" && !event.shiftKey && at.current) {
        const node = latest.current.nodes.find((candidate) => candidate.id === at.current);
        // A walk along the history stands on commits, and a commit is nobody's
        // to end. It keeps its own D, which is the browser's.
        if (node?.type !== "cli") return;
        event.preventDefault();
        // A held key is one press. Left to repeat, this would run down the
        // stack a frame at a time, and every one of these takes a shell with it.
        if (event.repeat) return;

        // Where the next press lands: whichever terminal takes this one's
        // number, or the one before it when this was the last of them. Picked
        // out and not shown — a terminal is opened by being gone to, and
        // nobody asked for the neighbour of what they just closed.
        const stacks = places.current;
        const place = stacks.findIndex((stack) => stack.id === node.id);
        const next = stacks[place + 1] ?? stacks[place - 1] ?? null;
        at.current = next?.id ?? null;
        // A number typed before this named a terminal by a number that is
        // about to belong to another one.
        typed.current = null;
        setPicked(next?.id ?? null);
        latest.current.end(node);
        return;
      }

      const direction = DIRECTIONS[event.key];
      if (direction) {
        // A terminal is walked out of from inside it. Anything else being typed
        // into keeps its own arrows, which move a cursor through what is written.
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

import type { Edge, ReactFlowInstance } from "@xyflow/react";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CliJumps } from "../components/cliJumps";
import { type AppNode, commitNodeId } from "../lib/graph";
import { first, history, jumpable, type Pickable, pickables, step } from "../lib/graphNav";
import { terminal, typing } from "../lib/keys";
import { revealing } from "../lib/reveal";

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
  /** Cut a branch at the commit the walk is standing on, under the name
   *  nobody was asked for. */
  branch: (node: AppNode) => void;
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
 * reached. Ctrl and Shift is the other walk, along the history: the pair on
 * their own already stand it on a commit — the history is what is being read
 * from the moment they are down — and the arrows step along from there. Nothing
 * is opened out there; Return is what opens it, and A cuts a branch at the
 * commit the walk is standing on. Ctrl and D ends the terminal the walk is
 * standing on, which is the one key here that takes something away rather than
 * going to it.
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
  branch,
  land,
  selected,
}: Options) {
  const [picked, setPicked] = useState<string | null>(null);
  // Whether Ctrl is down, which is the whole of what puts the numbers on the
  // terminals. Only the marks read it, so it costs a render of those and
  // nothing else.
  const [holding, setHolding] = useState(false);
  // And whether Shift is down beside it, which is the history being read: every
  // commit says what it is while the pair are held, and the one the walk is
  // standing on says the whole of it. Apart from `holding` because the two are
  // read in different places, and a canvas of messages is not drawn for Ctrl on
  // its own.
  const [reading, setReading] = useState(false);
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
  const latest = useRef({ nodes, activate, jump, end, branch, land, selected, shown, shownCommit });
  latest.current = { nodes, activate, jump, end, branch, land, selected, shown, shownCommit };
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

  /**
   * Brings a pick into view, as far as the window has been told to go.
   *
   * The middle of the three is what this always did and is still what a window
   * nobody has told does: move only once the walk has reached the edge of the
   * pane, which is the least that keeps the mark from walking off it. The other
   * two are the ends of that — a canvas that never moves under a key, and one
   * that puts every step in the middle of the pane. See `reveal`, which is
   * where the choice is kept and why there is one.
   */
  const reveal = useCallback(
    (pick: Pickable) => {
      const how = revealing();
      if (how === "never") return;
      const flow = instance.current;
      if (!flow) return;

      const { x, y, zoom } = flow.getViewport();
      if (how === "edge") {
        const box = host.current?.getBoundingClientRect();
        if (!box) return;
        const onScreen = { x: pick.x * zoom + x, y: pick.y * zoom + y };
        const inside =
          onScreen.x >= MARGIN &&
          onScreen.y >= MARGIN &&
          onScreen.x <= box.width - MARGIN &&
          onScreen.y <= box.height - MARGIN;
        if (inside) return;
      }

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
      setReading(false);
    };

    /**
     * Stands the walk on a pick: it is lit, the canvas comes as far towards it
     * as it has been told to, and the window is told what was landed on.
     *
     * The one place any of that happens, because every way of arriving —
     * a step, a number, the pair of keys that begins a walk — arrives the same.
     */
    const stand = (pick: Pickable): AppNode | null => {
      at.current = pick.id;
      // A digit typed before this named somewhere the walk has since left.
      typed.current = null;
      setPicked(pick.id);
      reveal(pick);
      const node = latest.current.nodes.find((candidate) => candidate.id === pick.id) ?? null;
      latest.current.land(node);
      return node;
    };

    /**
     * Where a walk along the history sets out from.
     *
     * The commit already picked out, if there is one: a commit that was clicked
     * or walked to is where the eye is, and Shift arriving is no reason to send
     * it anywhere else. Failing that the commit under the terminal the panel is
     * holding, which is where the work in view actually stands, and failing
     * that the first commit on the canvas.
     */
    const origin = (): Pickable | null => {
      const among = along.current;
      const { selected, shownCommit } = latest.current;
      return (
        (selected ? among.find((pick) => pick.id === selected) : null) ??
        (shownCommit ? among.find((pick) => pick.id === shownCommit) : null) ??
        first(among)
      );
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

      // Where the arrows would carry on from, so a jump is somewhere to walk
      // out of rather than a place the walk has never heard of.
      const node = stand(stacks[wanted - 1]);
      // After standing on it, which clears whatever digit came before: this is
      // the digit that is now open to a second one.
      typed.current = { number: wanted, at: Date.now() };
      if (node) latest.current.jump(node);
    };

    /** A step of a walk, from wherever the last one left off — either walk sets
     *  out from where the other stopped, which is why what it is standing on is
     *  looked up in every node rather than in what is being walked. */
    const walk = (direction: { x: number; y: number }, terminals: boolean) => {
      const among = terminals ? places.current : along.current;
      // The first history press chooses its origin. Later presses walk from it
      // — and holding Shift has usually chosen it already, which is what leaves
      // this to the walk that began before the window could pick anything out.
      const beginning = terminals || at.current ? null : origin();
      // Where the walk is, or failing that where the eye is: the terminal the
      // panel is holding, or a commit that has been picked out already.
      const standing =
        at.current ?? (terminals ? latest.current.shown : null) ?? latest.current.selected;
      const from = index.current.find((pick) => pick.id === standing);
      const next = beginning ?? (from ? step(from, among, direction) : first(among));
      if (!next) return;

      const node = stand(next);
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

      // A field being written in keeps Ctrl and Shift: that pair with an arrow
      // is how a word is selected, and none of what they mean out here is worth
      // taking that away for. A terminal is the exception it always is — the
      // window's keys matter most in there, which is what `terminal` is for.
      const writing = typing(event.target) && !terminal(event.target);

      // Ctrl and Shift: the walk along the history, standing on a commit from
      // the moment the pair are down rather than from the first arrow. Two
      // things wanted that. The history says what it is while they are held —
      // every commit its message, and this one the whole of it — and there is
      // no reading a history a key has not arrived at yet. And A cuts a branch
      // at whatever the walk is standing on, which has to be a commit somebody
      // has been shown before it is a commit they can cut from.
      if (event.shiftKey && !writing) {
        setReading(true);
        if (!at.current) {
          const start = origin();
          if (start) stand(start);
        }
      }

      // A number: the same key the terminal is told to leave alone, so that the
      // one press is answered once and here.
      if (numeric(event)) {
        event.preventDefault();
        // A held key is one press. Left to repeat, a number would read its own
        // repeats as the digits after it and walk away down the stack.
        if (!event.repeat) jumpTo(Number(event.key));
        return;
      }

      // A: a branch cut at the commit the walk is standing on, under the name
      // nobody was asked for — `draftBranchName`'s, which is the name the menu
      // opens with and the whole of what it suggests. The third A this window
      // answers: Ctrl and A opens another terminal in the workspace on show,
      // Ctrl and Alt and A asks that workspace what it can run, and this one is
      // on the history's own pair of keys because the history is what is being
      // read when a branch is wanted. The menu is still there for a branch that
      // wants a name of its own — see `CommitMenu`, and the offer over the dot
      // that opens it.
      if (event.shiftKey && !writing && event.key.toLowerCase() === "a" && at.current) {
        const node = latest.current.nodes.find((candidate) => candidate.id === at.current);
        // Only a commit is a thing to cut from. A walk that stopped on a
        // terminal leaves A where it has always gone, which in a shell is the
        // beginning of the line.
        if (node?.type !== "commit") return;
        event.preventDefault();
        // A held key is one press. Left to repeat, this would cut a branch a
        // frame for as long as the finger was down, and every one of them makes
        // a directory.
        if (event.repeat) return;
        latest.current.branch(node);
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
        if (writing) return;
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
      // Shift on its own only ends the reading. Where the walk had got to is
      // kept, because the two walks are one: letting go of Shift is stepping
      // from the history back to the terminals, not leaving.
      if (event.key === "Shift") setReading(false);
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
  return { picked, jumps, reading };
}

/** One of the ten keys a terminal can be reached by. */
function numeric(event: KeyboardEvent): boolean {
  return event.key.length === 1 && event.key >= "0" && event.key <= "9";
}

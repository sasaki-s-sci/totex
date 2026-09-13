import type { Edge, ReactFlowInstance } from "@xyflow/react";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type AppNode, commitNodeId } from "../../lib/graph";
import {
  first,
  history,
  jumpable,
  neighbour,
  type Pickable,
  pickables,
  step,
} from "../../lib/graphNav";
import { terminal, typing } from "../../lib/keys";
import { revealing } from "../../lib/reveal";
import type { CliJumps } from "../cliJumps";

const DIRECTIONS: Record<string, { x: number; y: number }> = {
  ArrowRight: { x: 1, y: 0 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

const MARGIN = 72;
const PAN_MS = 180;

const RUN_MS = 700;

type Options = {
  nodes: readonly AppNode[];
  instance: RefObject<ReactFlowInstance<AppNode, Edge> | null>;
  host: RefObject<HTMLDivElement | null>;

  activate: (node: AppNode) => void;

  jump: (node: AppNode) => void;

  end: (node: AppNode) => void;

  branch: (node: AppNode) => void;

  land: (node: AppNode | null) => void;

  selected: string | null;
};

// Held, not toggled: the pick leaves with Ctrl. It is written onto the node element rather than through the graph, which would rebuild every node.
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

  const [holding, setHolding] = useState(false);

  const [reading, setReading] = useState(false);

  const shown = useMemo(
    () => nodes.find((node) => node.type === "cli" && node.data.showing)?.id ?? null,
    [nodes],
  );

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

  // Listeners are registered once and read everything through this.
  const latest = useRef({ nodes, activate, jump, end, branch, land, selected, shown, shownCommit });
  latest.current = { nodes, activate, jump, end, branch, land, selected, shown, shownCommit };

  // Rebuilt with the graph only: key repeat outpaces canvas changes.
  const picks = useMemo(() => pickables(nodes), [nodes]);
  const index = useRef(picks);
  index.current = picks;

  const stacks = useMemo(() => jumpable(nodes), [nodes]);
  const places = useRef(stacks);
  places.current = stacks;

  const trail = useMemo(() => history(nodes), [nodes]);
  const along = useRef(trail);
  along.current = trail;
  const numbers = useMemo(
    () => new Map(stacks.map((stack, place) => [stack.id, place + 1])),
    [stacks],
  );
  const at = useRef<string | null>(null);

  const typed = useRef<{ number: number; at: number } | null>(null);

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

    const stand = (pick: Pickable): AppNode | null => {
      at.current = pick.id;

      typed.current = null;
      setPicked(pick.id);
      reveal(pick);
      const node = latest.current.nodes.find((candidate) => candidate.id === pick.id) ?? null;
      latest.current.land(node);
      return node;
    };

    const origin = (): Pickable | null => {
      const among = along.current;
      const { selected, shownCommit } = latest.current;
      return (
        (selected ? among.find((pick) => pick.id === selected) : null) ??
        (shownCommit ? among.find((pick) => pick.id === shownCommit) : null) ??
        first(among)
      );
    };

    const jumpTo = (digit: number) => {
      const stacks = places.current;
      const running = typed.current;
      const carried = running && Date.now() - running.at < RUN_MS ? running.number * 10 + digit : 0;
      const wanted = carried >= 1 && carried <= stacks.length ? carried : digit;
      if (wanted < 1 || wanted > stacks.length) {
        typed.current = null;
        return;
      }

      const node = stand(stacks[wanted - 1]);

      typed.current = { number: wanted, at: Date.now() };
      if (node) latest.current.jump(node);
    };

    const walkTerminals = (direction: { x: number; y: number }) => {
      const by = direction.x + direction.y > 0 ? 1 : -1;

      const standing = at.current ?? latest.current.shown;
      const next = neighbour(standing, places.current, by);
      if (!next) return;

      const node = stand(next);

      if (node) latest.current.jump(node);
    };

    const walkHistory = (direction: { x: number; y: number }) => {
      const among = along.current;

      const beginning = at.current ? null : origin();

      const standing = at.current ?? latest.current.selected;
      const from = index.current.find((pick) => pick.id === standing);
      const next = beginning ?? (from ? step(from, among, direction) : first(among));
      if (!next) return;
      stand(next);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      // Ctrl alone; Alt and Meta combinations belong to something else.
      if (!event.ctrlKey || event.altKey || event.metaKey) return;

      setHolding(true);

      // A text field keeps Ctrl+Shift+Arrow for word selection; a terminal does not.
      const writing = typing(event.target) && !terminal(event.target);

      if (event.shiftKey && !writing) {
        setReading(true);
        if (!at.current) {
          const start = origin();
          if (start) stand(start);
        }
      }

      if (numeric(event)) {
        event.preventDefault();

        // A held digit would read its own repeats as further digits.
        if (!event.repeat) jumpTo(Number(event.key));
        return;
      }

      if (event.shiftKey && !writing && event.key.toLowerCase() === "a" && at.current) {
        const node = latest.current.nodes.find((candidate) => candidate.id === at.current);

        if (node?.type !== "commit") return;
        event.preventDefault();

        if (event.repeat) return;
        latest.current.branch(node);
        return;
      }

      // The ended shell sees the ^D as well; stopping that would cost every terminal its EOF.
      if (event.key.toLowerCase() === "d" && !event.shiftKey && at.current) {
        const node = latest.current.nodes.find((candidate) => candidate.id === at.current);

        if (node?.type !== "cli") return;
        event.preventDefault();

        if (event.repeat) return;

        const stacks = places.current;
        const place = stacks.findIndex((stack) => stack.id === node.id);
        const next = stacks[place + 1] ?? stacks[place - 1] ?? null;
        at.current = next?.id ?? null;

        typed.current = null;
        setPicked(next?.id ?? null);
        latest.current.end(node);
        return;
      }

      const direction = DIRECTIONS[event.key];
      if (direction) {
        if (writing) return;
        event.preventDefault();
        if (event.shiftKey) walkHistory(direction);
        else walkTerminals(direction);
        return;
      }

      if (typing(event.target)) return;

      if (event.key === "Enter" && at.current) {
        event.preventDefault();
        const node = latest.current.nodes.find((candidate) => candidate.id === at.current);
        if (node) latest.current.activate(node);
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Control") drop();

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

    const timer = setTimeout(mark, PAN_MS + 80);
    return () => clearTimeout(timer);
  }, [picked, nodes, host]);

  const jumps: CliJumps = holding ? numbers : null;
  return { picked, jumps, reading };
}

function numeric(event: KeyboardEvent): boolean {
  return event.key.length === 1 && event.key >= "0" && event.key <= "9";
}

import type { Edge, ReactFlowInstance } from "@xyflow/react";
import { type RefObject, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AppNode, OfferFlowNode } from "../../lib/graph";
import {
  first,
  jumpable,
  nearest,
  neighbour,
  neighbourRow,
  offered,
  type Pickable,
  step,
} from "../../lib/graphNav";
import { terminal, typing } from "../../lib/keys";
import { revealing } from "../../lib/reveal";
import { isWrapping } from "../../lib/walk";
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

  /** What Ctrl+Shift stands on the canvas; see `OfferData`. */
  offers: readonly OfferFlowNode[];
  instance: RefObject<ReactFlowInstance<AppNode, Edge> | null>;
  host: RefObject<HTMLDivElement | null>;

  activate: (node: AppNode) => void;

  jump: (node: AppNode) => void;

  end: (node: AppNode) => void;

  take: (offer: OfferFlowNode) => void;
};

// Held, not toggled: the pick leaves with Ctrl. It is written onto the node element rather than through the graph, which would rebuild every node.
// Ctrl walks the terminals that exist; Ctrl+Shift walks the ones that could, and Enter starts the one stood on.
export function useGraphKeys({
  nodes,
  offers,
  instance,
  host,
  activate,
  jump,
  end,
  take,
}: Options) {
  const [picked, setPicked] = useState<string | null>(null);

  const [holding, setHolding] = useState(false);

  const [offering, setOffering] = useState(false);

  const shown = useMemo(
    () => nodes.find((node) => node.type === "cli" && node.data.showing)?.id ?? null,
    [nodes],
  );

  // Listeners are registered once and read everything through this.
  const latest = useRef({ nodes, offers, activate, jump, end, take, shown });
  latest.current = { nodes, offers, activate, jump, end, take, shown };

  // Rebuilt with the graph only: key repeat outpaces canvas changes.
  const stacks = useMemo(() => jumpable(nodes), [nodes]);
  const places = useRef(stacks);
  places.current = stacks;

  const open = useMemo(() => offered(nodes, offers), [nodes, offers]);
  const along = useRef(open);
  along.current = open;
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
      setOffering(false);
    };

    const stand = (pick: Pickable): AppNode | null => {
      at.current = pick.id;

      typed.current = null;
      setPicked(pick.id);
      reveal(pick);
      return latest.current.nodes.find((candidate) => candidate.id === pick.id) ?? null;
    };

    const offerAt = (id: string | null): OfferFlowNode | null =>
      (id ? latest.current.offers.find((offer) => offer.id === id) : null) ?? null;

    // The offer nearest the terminal looked at: the walk starts from where the eyes are.
    const origin = (): Pickable | null => {
      const among = along.current;
      const from = places.current.find((stack) => stack.id === latest.current.shown);
      return from ? nearest(from, among) : first(among);
    };

    // Standing on nothing once taken: the offer is gone as soon as its terminal stands.
    const takeOffer = (offer: OfferFlowNode) => {
      at.current = null;
      setPicked(null);
      latest.current.take(offer);
    };

    const leaveOffers = () => {
      setOffering(false);
      if (!offerAt(at.current)) return;
      at.current = null;
      setPicked(null);
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

    // Up and Down go a terminal at a time; Left and Right go a repository or folder at a time.
    const walkTerminals = (direction: { x: number; y: number }) => {
      const by = direction.x + direction.y > 0 ? 1 : -1;

      const standing = at.current ?? latest.current.shown;
      const walk = direction.x ? neighbourRow : neighbour;
      const next = walk(standing, places.current, by, isWrapping());
      if (!next) return;

      const node = stand(next);

      if (node) latest.current.jump(node);
    };

    const walkOffers = (direction: { x: number; y: number }) => {
      const among = along.current;
      const from = among.find((pick) => pick.id === at.current);
      const next = from ? step(from, among, direction) : origin();
      if (next) stand(next);
    };

    const onKeyDown = (event: KeyboardEvent) => {
      // Ctrl alone; Alt and Meta combinations belong to something else.
      if (!event.ctrlKey || event.altKey || event.metaKey) return;

      setHolding(true);

      // A text field keeps Ctrl+Shift+Arrow for word selection; a terminal does not.
      const writing = typing(event.target) && !terminal(event.target);

      if (event.shiftKey && !writing) {
        setOffering(true);
        if (!offerAt(at.current)) {
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

      // A new workspace without walking to its offer: in the repository stood in, else the one looked at.
      if (event.shiftKey && !writing && event.key.toLowerCase() === "a") {
        const { offers, nodes, shown } = latest.current;
        const standing = offerAt(at.current)?.data.repository?.id;
        const looking = nodes.find((candidate) => candidate.id === shown)?.parentId;
        const fresh = offers.filter((offer) => offer.data.kind === "new");
        const offer =
          fresh.find((candidate) => candidate.data.repository?.id === (standing ?? looking)) ??
          (fresh.length === 1 ? fresh[0] : null);
        if (!offer) return;
        event.preventDefault();

        if (!event.repeat) takeOffer(offer);
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
        if (event.shiftKey) walkOffers(direction);
        else walkTerminals(direction);
        return;
      }

      // Taken from inside a terminal too, which is where the hands usually are.
      const offer = event.shiftKey && !writing ? offerAt(at.current) : null;
      if (event.key === "Enter" && offer) {
        event.preventDefault();
        if (!event.repeat) takeOffer(offer);
        return;
      }

      if (typing(event.target)) return;

      if (event.key === "Enter" && at.current) {
        event.preventDefault();
        const node = latest.current.nodes.find((candidate) => candidate.id === at.current);
        if (node) latest.current.activate(node);
      }
    };

    const syncModifiers = (event: KeyboardEvent) => {
      if (!event.ctrlKey) drop();
      else if (!event.shiftKey) leaveOffers();
    };

    const onVisibilityChange = () => {
      if (document.hidden) drop();
    };

    // Observe releases before an input can stop propagation. Also recover on the next
    // key press if the WebView missed a release while focus was elsewhere.
    window.addEventListener("keydown", syncModifiers, true);
    window.addEventListener("keyup", syncModifiers, true);
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("visibilitychange", onVisibilityChange);

    // A window that loses focus never sees the key come back up.
    window.addEventListener("blur", drop);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keydown", syncModifiers, true);
      window.removeEventListener("keyup", syncModifiers, true);
      window.removeEventListener("blur", drop);
      document.removeEventListener("visibilitychange", onVisibilityChange);
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

    // An offer is handed to React Flow in this same render and is on the canvas a frame later.
    const frame = requestAnimationFrame(mark);
    const timer = setTimeout(mark, PAN_MS + 80);
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [picked, nodes, host, offering]);

  const jumps: CliJumps = holding ? numbers : null;
  return { picked, jumps, offering };
}

function numeric(event: KeyboardEvent): boolean {
  return event.key.length === 1 && event.key >= "0" && event.key <= "9";
}

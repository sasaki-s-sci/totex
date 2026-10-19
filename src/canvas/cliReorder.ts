import { type Edge, useReactFlow } from "@xyflow/react";
import { type PointerEvent, useRef } from "react";
import type { AppNode } from "../lib/graph";
import { pickables } from "../lib/graphNav";
import type { Session } from "../lib/session";
import { useGraphActions } from "./graphActions";

// Held this long, the icon stops being a click and follows the pointer instead.
const HOLD_MS = 350;
// A press that slides this far before the hold is a click or a drag, never a hold.
const SLIP_PX = 4;

type Hold = {
  pointer: number;
  x: number;
  y: number;
  timer: ReturnType<typeof setTimeout>;
  held: boolean;
  moved: boolean;
  // How many of the row's other terminals sit above this one.
  above: number;
};

type Rival = { id: string; session: Session; y: number };

function aboveOf(others: readonly Rival[], y: number) {
  return others.filter((other) => other.y <= y).length;
}

/**
 * Hold a terminal's icon, then move it up or down: it takes its place among the terminals in the
 * same folder or repository row, never another. A click that follows a move is not a click.
 */
export function useCliReorder(id: string, session: Session, group: string) {
  const flow = useReactFlow<AppNode, Edge>();
  const { placeSession } = useGraphActions();
  const hold = useRef<Hold | null>(null);
  const swapped = useRef(false);

  // The row's terminals top to bottom, each with the height it is drawn at.
  const row = (): Rival[] => {
    const all = flow.getNodes();
    const sessions = new Map(
      all.flatMap((node) => (node.type === "cli" ? [[node.id, node.data.session] as const] : [])),
    );
    return pickables(all)
      .filter((pick) => pick.group === group)
      .flatMap((pick) => {
        const held = sessions.get(pick.id);
        return held ? [{ id: pick.id, session: held, y: pick.y }] : [];
      })
      .sort((one, other) => one.y - other.y);
  };

  const onPointerDown = (event: PointerEvent<HTMLElement>) => {
    event.stopPropagation();
    swapped.current = false;
    if (event.button !== 0) return;

    const target = event.currentTarget;
    const timer = setTimeout(() => {
      const current = hold.current;
      if (!current) return;

      const picks = row();
      const self = picks.find((pick) => pick.id === id);
      current.held = true;
      current.above = self
        ? aboveOf(
            picks.filter((pick) => pick.id !== id),
            self.y,
          )
        : 0;
      target.setPointerCapture(current.pointer);
      target.classList.add("is-moving");
    }, HOLD_MS);
    hold.current = {
      pointer: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      timer,
      held: false,
      moved: false,
      above: 0,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLElement>) => {
    const current = hold.current;
    if (!current) return;

    if (!current.held) {
      if (Math.hypot(event.clientX - current.x, event.clientY - current.y) <= SLIP_PX) return;
      clearTimeout(current.timer);
      hold.current = null;
      return;
    }

    const others = row().filter((pick) => pick.id !== id);
    if (others.length === 0) return;

    const { y } = flow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
    const above = aboveOf(others, y);
    if (above === current.above) return;

    current.above = above;
    current.moved = true;
    // Before the first terminal below the pointer, else after the last one above it.
    placeSession(
      session,
      others[Math.min(above, others.length - 1)].session,
      above >= others.length,
    );
  };

  const onPointerUp = (event: PointerEvent<HTMLElement>) => {
    const current = hold.current;
    if (!current) return;

    clearTimeout(current.timer);
    hold.current = null;
    if (!current.held) return;

    swapped.current = current.moved;
    event.currentTarget.releasePointerCapture(current.pointer);
    event.currentTarget.classList.remove("is-moving");
  };

  // Read once by the click that follows the release.
  const takeMoved = () => {
    const was = swapped.current;
    swapped.current = false;
    return was;
  };

  return {
    pointer: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel: onPointerUp,
    },
    takeMoved,
  };
}

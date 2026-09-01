import { type PointerEvent, type RefObject, useCallback, useRef } from "react";

import { HEADER_HEIGHT } from "../components/WindowControls";

/** What a card's header comes to: the least of a card that has to stay reachable. */
const HEADER_ROW = 20;

/** Between the two, and at the lower of them when there is no room between. */
function hold(value: number, least: number, most: number): number {
  return Math.max(least, Math.min(most, value));
}

/**
 * Where a card pinned over the canvas may stand, in the pane's own pixels.
 *
 * Inside the pane, so that a card cannot be put or dragged out of the window
 * it is being read in — and never higher than the band along the top, which
 * picks the window up and would take the presses on a header underneath it.
 * The foot of the card is free to go past the bottom: a reading is as long as
 * the file, and what is being read is the top of it.
 */
export function heldInPane(
  at: { x: number; y: number },
  pane: { width: number; height: number },
  width: number,
): { x: number; y: number } {
  return {
    x: hold(at.x, 0, pane.width - width),
    y: hold(at.y, HEADER_HEIGHT, pane.height - HEADER_ROW),
  };
}

/** How many cards have been picked up, so the last one is the one in front. */
let raised = 0;

type Held = {
  requestId: number;
  card: HTMLElement;
  /** Where the pointer took hold, so the card moves with it rather than to it. */
  grab: { x: number; y: number };
  width: number;
  pane: { width: number; height: number };
};

/**
 * Moving a pinned card about the window by its header.
 *
 * A card standing on the canvas is dragged by the canvas — React Flow moves the
 * node and the graph goes with it. A pinned card has left the canvas, so this is
 * the whole of what moves it: the pin takes the card out of everything the
 * graph is doing, not out of the reader's hands.
 *
 * Written straight to the element for the length of the drag and handed to React
 * only where it comes to rest. A pointer reports many times a frame, and a move
 * committed per event would rebuild the node array — every card and every mark
 * on the canvas visited — for a card the canvas is not even holding.
 */
export function usePinDrag(
  pane: RefObject<HTMLElement | null>,
  moved: (requestId: number, at: { x: number; y: number }) => void,
) {
  const held = useRef<Held | null>(null);

  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>, requestId: number) => {
      if (event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      // The header and nothing else — a reading is selected and typed into, and
      // the marks in the header are pressed rather than dragged.
      if (!target.closest(".page__header")) return;
      if (target.closest(".page__tool")) return;

      const card = event.currentTarget;
      const box = pane.current?.getBoundingClientRect();
      if (!box) return;

      // Picked up is in front: pinned cards are drawn in the order they were
      // opened, and a card reached for from underneath another has to come out
      // from under it. Written to the element, because the order they are drawn
      // in is not something the graph has to be rebuilt for.
      raised += 1;
      card.style.zIndex = String(raised);
      held.current = {
        requestId,
        card,
        grab: { x: event.clientX - card.offsetLeft, y: event.clientY - card.offsetTop },
        width: card.offsetWidth,
        pane: { width: box.width, height: box.height },
      };
      card.setPointerCapture(event.pointerId);
      // Or the header's own text is selected on the way past.
      event.preventDefault();
    },
    [pane],
  );

  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const drag = held.current;
    if (!drag) return;
    const at = heldInPane(
      { x: event.clientX - drag.grab.x, y: event.clientY - drag.grab.y },
      drag.pane,
      drag.width,
    );
    drag.card.style.left = `${at.x}px`;
    drag.card.style.top = `${at.y}px`;
  }, []);

  /** Where it was let go is where it is: the graph is told once, here. */
  const onPointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const drag = held.current;
      if (!drag) return;
      held.current = null;
      if (drag.card.hasPointerCapture(event.pointerId)) {
        drag.card.releasePointerCapture(event.pointerId);
      }
      moved(drag.requestId, { x: drag.card.offsetLeft, y: drag.card.offsetTop });
    },
    [moved],
  );

  return { onPointerDown, onPointerMove, onPointerUp };
}

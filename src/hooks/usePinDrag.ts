import { type PointerEvent, type RefObject, useCallback, useRef } from "react";

import { HEADER_HEIGHT } from "../components/WindowControls";
import { corner, outsideWindow, type Point } from "../lib/cardWindow";

/** A point on the page said in the pane's pixels. */
function inPane(client: Point, origin: Point): Point {
  return { x: client.x - origin.x, y: client.y - origin.y };
}

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

/**
 * What takes a card that is dragged out of the window altogether.
 *
 * A pinned card is held inside the pane by `heldInPane`, and the pointer is
 * not: dragged on past the edge, it is still holding the card. This is what is
 * told so, and what the drag is handed to from then on — see `useCardWindows`,
 * which puts the card in a window of its own under the pointer.
 */
export type Tearing = {
  /**
   * The pointer has left the window with this card in hand. Answers whether
   * the card is being taken out; a card that cannot go stays held in the pane.
   */
  begin(requestId: number, card: HTMLElement, grab: Point, at: Point): boolean;
  /** Where the pointer is now, on screen. */
  carry(at: Point): void;
  /**
   * Let go: on screen at `at`, and — when it was let go over the pane — at
   * `pane` in the pane's own pixels, which is where the card's corner lands.
   * Answers whether the card has gone out to its window, or is back in hand.
   */
  end(at: Point, pane: Point | null): boolean;
};

/** How many cards have been picked up, so the last one is the one in front. */
let raised = 0;

type Held = {
  requestId: number;
  card: HTMLElement;
  /** Where the pointer took hold, from the card's own corner, so the card
   *  moves with it rather than to it. */
  grab: Point;
  /** Where the pane starts on the page, which is what a pointer position is
   *  taken from to say it in the pane's pixels. */
  origin: Point;
  width: number;
  pane: { width: number; height: number };
  /** Out past the edge of the window, and in the hands of `Tearing` from there. */
  torn: boolean;
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
 *
 * Dragged out of the window, the card is handed to `tearing` and the pointer
 * stays captured here: the element under the capture is what the pointer
 * reports to, whichever window it is over, and it is kept standing — hidden,
 * once the card is drawn elsewhere — for exactly that reason.
 */
export function usePinDrag(
  pane: RefObject<HTMLElement | null>,
  moved: (requestId: number, at: { x: number; y: number }) => void,
  tearing?: Tearing,
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
      if (target.closest(".page__tool, button, select, input, label")) return;

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
        grab: {
          x: event.clientX - box.left - card.offsetLeft,
          y: event.clientY - box.top - card.offsetTop,
        },
        origin: { x: box.left, y: box.top },
        width: card.getBoundingClientRect().width,
        pane: { width: box.width, height: box.height },
        torn: false,
      };
      card.setPointerCapture(event.pointerId);
      // Or the header's own text is selected on the way past.
      event.preventDefault();
    },
    [pane],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const drag = held.current;
      if (!drag) return;
      const screen = { x: event.screenX, y: event.screenY };
      if (drag.torn) {
        tearing?.carry(screen);
        return;
      }
      if (
        tearing &&
        outsideWindow(
          { x: event.clientX, y: event.clientY },
          { width: window.innerWidth, height: window.innerHeight },
        ) &&
        tearing.begin(drag.requestId, drag.card, drag.grab, screen)
      ) {
        drag.torn = true;
      }
      // Held at the edge while it is on its way out: the card in the pane stays
      // where the pointer left the window until it is drawn under the pointer
      // elsewhere, or until the pointer comes back for it.
      const at = heldInPane(
        corner(inPane({ x: event.clientX, y: event.clientY }, drag.origin), drag.grab),
        drag.pane,
        drag.width,
      );
      drag.card.style.left = `${at.x}px`;
      drag.card.style.top = `${at.y}px`;
    },
    [tearing],
  );

  /** Where it was let go is where it is: the graph is told once, here. */
  const onPointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const drag = held.current;
      if (!drag) return;
      held.current = null;
      if (drag.card.hasPointerCapture(event.pointerId)) {
        drag.card.releasePointerCapture(event.pointerId);
      }
      if (drag.torn && tearing) {
        const pointer = inPane({ x: event.clientX, y: event.clientY }, drag.origin);
        const over = event.type !== "pointercancel" && !outsideWindow(pointer, drag.pane);
        const at = over ? corner(pointer, drag.grab) : null;
        if (tearing.end({ x: event.screenX, y: event.screenY }, at)) return;
        // Back in hand: put it down where it was let go, inside the pane.
        const rest = heldInPane(
          at ?? { x: drag.card.offsetLeft, y: drag.card.offsetTop },
          drag.pane,
          drag.width,
        );
        drag.card.style.visibility = "";
        drag.card.style.left = `${rest.x}px`;
        drag.card.style.top = `${rest.y}px`;
      }
      moved(drag.requestId, { x: drag.card.offsetLeft, y: drag.card.offsetTop });
    },
    [moved, tearing],
  );

  return { onPointerDown, onPointerMove, onPointerUp };
}

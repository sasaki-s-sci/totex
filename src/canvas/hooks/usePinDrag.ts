import { type RefObject, useCallback, useRef } from "react";
import { corner, outsideWindow, type Point } from "../../lib/cardWindow";
import { HEADER_HEIGHT } from "../../window/WindowControls";

function inPane(client: Point, origin: Point): Point {
  return { x: client.x - origin.x, y: client.y - origin.y };
}

const HEADER_ROW = 20;

function hold(value: number, least: number, most: number): number {
  return Math.max(least, Math.min(most, value));
}

// Inside the pane and below the window's drag band; the foot may hang past the bottom.
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

export type Tearing = {
  begin(requestId: number, card: HTMLElement, grab: Point, at: Point): boolean;

  carry(at: Point): void;

  end(at: Point, pane: Point | null): boolean;
};

let raised = 0;

type Held = {
  requestId: number;
  card: HTMLElement;

  grab: Point;

  origin: Point;
  width: number;
  pane: { width: number; height: number };

  torn: boolean;
};

// Written to the element during the drag; a commit per pointer event would rebuild the node array. Pointer capture stays here even once the card is torn into its own window.
export function usePinDrag(
  pane: RefObject<HTMLElement | null>,
  moved: (requestId: number, at: { x: number; y: number }) => void,
  tearing?: Tearing,
) {
  const held = useRef<Held | null>(null);

  const onPointerDown = useCallback(
    (event: PointerEvent, requestId: number) => {
      if (event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      if (!target.closest(".page__header")) return;
      if (target.closest(".page__tool, button, select, input, label")) return;

      const card = event.currentTarget;
      if (!(card instanceof HTMLDivElement)) return;
      const box = pane.current?.getBoundingClientRect();
      if (!box) return;

      raised += 1;
      // Picked up comes to the front; on the element, so the graph is not rebuilt.
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

      event.preventDefault();
    },
    [pane],
  );

  const onPointerMove = useCallback(
    (event: PointerEvent) => {
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

  const onPointerUp = useCallback(
    (event: PointerEvent) => {
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

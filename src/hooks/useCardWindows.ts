/**
 * The main window's half of a card torn off it — see `lib/cardWindow`.
 *
 * Three things happen here. A pinned card dragged out of the window is given a
 * window of its own under the pointer, and the drag carries that window on
 * until it is let go: the pointer is still the main window's, captured on the
 * card it picked up, so the main window is what moves the new one. A card
 * window let go over the canvas — in that same drag or in a later one of its
 * own — is taken back as a pinned card where it landed, and the window closes.
 * And a card window whose pin is pressed comes back whether or not it is over
 * the canvas.
 */

import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { type RefObject, useCallback, useEffect, useMemo, useRef } from "react";
import { MIN_WIDTH } from "../components/nodes/FilePreviewNode";
import { draftKey } from "../components/nodes/preview/draft";
import {
  CARD_DROPPED,
  CARD_HELLO,
  CARD_SEED,
  CARD_SHOWN,
  type CardDraft,
  type CardSeed,
  cardLabel,
  corner,
  type Dropped,
  type Hello,
  inPane,
  onPane,
  type Point,
  type Seeded,
  type Shown,
} from "../lib/cardWindow";
import type { AppNode, FilePreviewFlowNode } from "../lib/graph";
import { mover } from "../lib/moveWindow";
import { readFrontValue } from "../shell/state";
import { fileSize } from "./filePreviewBox";
import { heldInPane, type Tearing } from "./usePinDrag";

/** A card on its way out, or out and still in hand. */
type Carried = {
  label: string;
  requestId: number;
  /** The card as drawn in the pane, kept standing under the pointer capture. */
  card: HTMLElement;
  grab: Point;
  /** What the window is told to draw, once the draft has been read into it. */
  seed: Promise<CardSeed>;
  window: Promise<WebviewWindow>;
  move: (at: Point) => void;
  /** Drawn and on screen, which is when the card in the pane goes out of sight. */
  shown: boolean;
};

export function useCardWindows({
  host,
  standing,
  closeFilePreview,
  openPinned,
}: {
  host: RefObject<HTMLElement | null>;
  standing: RefObject<readonly AppNode[]>;
  /** The card has gone to its window: take it off this one. */
  closeFilePreview: (requestId: number) => void;
  /** A card back from its window, pinned at a place in the pane's pixels. */
  openPinned: (seed: CardSeed, at: Point) => void;
}): Tearing {
  const held = useRef<Carried | null>(null);

  const begin = useCallback(
    (requestId: number, card: HTMLElement, grab: Point, at: Point): boolean => {
      if (held.current) return false;
      const node = standing.current.find(
        (candidate): candidate is FilePreviewFlowNode =>
          candidate.type === "file-preview" && candidate.data.requestId === requestId,
      );
      // The settings page is the window's own and stays in it.
      if (!node || node.data.pinnedAt === null || node.data.view === "settings") return false;

      const scale = node.data.pinnedScale ?? 1;
      const box = fileSize(node);
      const drawn = card.getBoundingClientRect();
      const start = corner(at, grab);
      const label = cardLabel();
      const seed = readFrontValue<CardDraft>(draftKey(requestId, node.data.path)).then(
        (draft): CardSeed => ({
          requestId,
          path: node.data.path,
          view: node.data.view,
          collapsed: node.data.collapsed,
          box,
          scale,
          draft: draft?.dirty ? draft : undefined,
        }),
      );
      const window = new Promise<WebviewWindow>((resolve, reject) => {
        // Hidden until the card is drawn in it, and never given the focus:
        // the pointer is held down over it, and the window under the pointer
        // is the one the drag belongs to.
        const opened = new WebviewWindow(label, {
          url: "index.html",
          title: node.data.name,
          x: start.x,
          y: start.y,
          width: drawn.width,
          height: drawn.height,
          minWidth: MIN_WIDTH * scale,
          decorations: false,
          transparent: true,
          shadow: false,
          visible: false,
          focus: false,
          resizable: true,
        });
        void opened.once("tauri://created", () => resolve(opened));
        void opened.once("tauri://error", (event) => reject(event.payload));
      });
      void window.catch(() => {
        // A window that would not open leaves the card where it was: the drag
        // goes on inside the pane as if nothing had been asked.
        if (held.current?.label === label) held.current = null;
      });
      held.current = {
        label,
        requestId,
        card,
        grab,
        seed,
        window,
        move: mover(window),
        shown: false,
      };
      return true;
    },
    [standing],
  );

  const carry = useCallback((at: Point) => {
    held.current?.move(corner(at, held.current.grab));
  }, []);

  const end = useCallback(
    (_at: Point, pane: Point | null): boolean => {
      const carried = held.current;
      if (!carried) return false;
      held.current = null;
      // Let go before the window was drawn, or let go back over the pane: the
      // card in the pane is the card, and the window goes.
      if (!carried.shown || pane) {
        void carried.window.then((window) => window.close()).catch(() => undefined);
        return false;
      }
      closeFilePreview(carried.requestId);
      return true;
    },
    [closeFilePreview],
  );

  /** A card window let go, or asking to come back: pinned where it landed. */
  const take = useCallback(
    async ({ label, seed, at, grab, force }: Dropped) => {
      const pane = host.current?.getBoundingClientRect();
      if (!pane) return;
      const here = getCurrentWindow();
      const [position, scale] = await Promise.all([here.innerPosition(), here.scaleFactor()]);
      const pointer = inPane(at, { x: position.x / scale, y: position.y / scale }, pane);
      if (!force && !onPane(pointer, pane)) return;
      openPinned(seed, heldInPane(corner(pointer, grab), pane, seed.box.width * seed.scale));
      const window = await WebviewWindow.getByLabel(label);
      await window?.close();
    },
    [host, openPinned],
  );

  useEffect(() => {
    let cancelled = false;
    const stops: UnlistenFn[] = [];
    const attend = <T>(event: string, handler: (payload: T) => void) => {
      void listen<T>(event, ({ payload }) => {
        if (!cancelled) handler(payload);
      })
        .then((stop) => {
          if (cancelled) stop();
          else stops.push(stop);
        })
        .catch(() => undefined);
    };
    attend<Hello>(CARD_HELLO, ({ label }) => {
      const carried = held.current;
      if (carried?.label !== label) return;
      void carried.seed
        .then((seed) => emitTo(label, CARD_SEED, { label, seed } satisfies Seeded))
        .catch(() => undefined);
    });
    attend<Shown>(CARD_SHOWN, ({ label }) => {
      const carried = held.current;
      if (carried?.label !== label) return;
      carried.shown = true;
      // Out of sight rather than gone: the pointer is captured on it, and the
      // capture goes with the element. It comes back into sight if the drag
      // comes back, and goes with the node once the drag is over.
      carried.card.style.visibility = "hidden";
    });
    attend<Dropped>(CARD_DROPPED, (dropped) => {
      void take(dropped).catch(() => undefined);
    });
    return () => {
      cancelled = true;
      for (const stop of stops) stop();
    };
  }, [take]);

  return useMemo(() => ({ begin, carry, end }), [begin, carry, end]);
}

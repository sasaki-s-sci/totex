import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { type RefObject, useCallback, useEffect, useMemo, useRef } from "react";
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
} from "../../lib/cardWindow";
import type { AppNode, FilePreviewFlowNode } from "../../lib/graph";
import { mover } from "../../lib/moveWindow";
import { readFrontValue } from "../../shell/state";
import { MIN_WIDTH } from "../nodes/FilePreviewNode";
import { draftKey } from "../nodes/preview/draft";
import { fileSize } from "./filePreviewBox";
import { heldInPane, type Tearing } from "./usePinDrag";

type Carried = {
  label: string;
  requestId: number;

  card: HTMLElement;
  grab: Point;

  seed: Promise<CardSeed>;
  window: Promise<WebviewWindow>;
  move: (at: Point) => void;

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

  closeFilePreview: (requestId: number) => void;

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
          // Hidden and never focused: the pointer is captured in this window, which owns the drag.
          visible: false,
          focus: false,
          resizable: true,
        });
        void opened.once("tauri://created", () => resolve(opened));
        void opened.once("tauri://error", (event) => reject(event.payload));
      });
      void window.catch(() => {
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

      if (!carried.shown || pane) {
        void carried.window.then((window) => window.close()).catch(() => undefined);
        return false;
      }
      closeFilePreview(carried.requestId);
      return true;
    },
    [closeFilePreview],
  );

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

      // Out of sight, not removed: pointer capture lives on the element.
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

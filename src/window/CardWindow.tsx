/**
 * One card filling a torn-off window, drawn at the scale it was pinned at. See `lib/cardWindow`.
 */

import { LogicalSize } from "@tauri-apps/api/dpi";
import { emit, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  type PointerEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { type GraphActions, GraphActionsProvider, NO_ACTIONS } from "../canvas/graphActions";
import { readFilePreview } from "../canvas/hooks/useFilePreviewPlacing";
import { FilePreviewCard } from "../canvas/nodes/FilePreviewNode";
import { draftKey } from "../canvas/nodes/preview/draft";
import { writeFile } from "../folder/api";
import { refreshChanges } from "../folder/changes";
import { baseName } from "../folder/format";
import { settingsDocument, writeSettingsText } from "../lib/appSettings";
import {
  CARD_DROPPED,
  CARD_HELLO,
  CARD_SEED,
  CARD_SHOWN,
  type CardDraft,
  type CardSeed,
  corner,
  type Dropped,
  type Hello,
  type Point,
  type Seeded,
  type Shown,
} from "../lib/cardWindow";
import type { FilePreviewNodeData } from "../lib/graph";
import { mover } from "../lib/moveWindow";
import { windowLabel } from "../lib/thisWindow";
import { keepFrontValue, readFrontValue } from "../shell/state";
import "../canvas/styles/index.css";
import "../canvas/styles/torn.css";

/** The card's own edge; `BORDERS` in the card. */
const BORDERS = 2;
const HEADER_ROW = 20;

function folded(card: HTMLElement | null, scale: number): number {
  const header = card?.querySelector(".page__header")?.getBoundingClientRect();
  return (header ? header.height / scale : HEADER_ROW) + BORDERS;
}

function opening(seed: CardSeed): FilePreviewNodeData {
  return {
    requestId: seed.requestId,
    path: seed.path,
    name: baseName(seed.path),
    text: null,
    picture: null,
    size: null,
    truncated: false,
    state: "loading",
    view: seed.view,
    collapsed: seed.collapsed,
    box: seed.box,
    pinnedAt: { x: 0, y: 0 },
    pinnedScale: seed.scale,
  };
}

export function CardWindow() {
  const label = useMemo(() => windowLabel(), []);
  const here = useMemo(() => getCurrentWindow(), []);
  const [data, setData] = useState<FilePreviewNodeData | null>(null);
  const seeded = useRef<CardSeed | null>(null);
  const scale = seeded.current?.scale ?? 1;
  const card = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    let stop: UnlistenFn | null = null;
    void listen<Seeded>(CARD_SEED, ({ payload }) => {
      if (cancelled || payload.label !== label || seeded.current) return;
      const seed = payload.seed;
      seeded.current = seed;
      // Put where the card's draft looks before the card is drawn.
      if (seed.draft) keepFrontValue(draftKey(seed.requestId, seed.path), seed.draft);
      setData(opening(seed));
      void readFilePreview(seed.path, seed.view)
        .then((read) => {
          if (cancelled) return;
          setData((held) => held && { ...held, ...read, state: "ready" });
        })
        .catch(() => {
          if (cancelled) return;
          setData((held) => held && { ...held, state: "failed" });
        });
    })
      .then((unlisten) => {
        if (cancelled) {
          unlisten();
          return;
        }
        stop = unlisten;
        return emit(CARD_HELLO, { label } satisfies Hello);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [label]);

  // Shown after the card's frame; that is when the main window lets go of its copy.
  const shown = useRef(false);
  useLayoutEffect(() => {
    if (shown.current || !data || data.state === "loading") return;
    shown.current = true;
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        void here
          .show()
          .then(() => emit(CARD_SHOWN, { label } satisfies Shown))
          .catch(() => undefined);
      }),
    );
  }, [data, here, label]);

  useEffect(() => {
    let cancelled = false;
    let stop: UnlistenFn | null = null;
    void here
      .onResized(async ({ payload }) => {
        const factor = await here.scaleFactor();
        if (cancelled) return;
        setData((held) => {
          if (!held) return held;
          const width = payload.width / factor / scale;
          const height = held.collapsed ? held.box.height : payload.height / factor / scale;
          return { ...held, box: { width, height } };
        });
      })
      .then((unlisten) => {
        if (cancelled) unlisten();
        else stop = unlisten;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
      stop?.();
    };
  }, [here, scale]);

  const size = useCallback(
    (width: number, height: number) =>
      here.setSize(new LogicalSize(width * scale, height * scale)).catch(() => undefined),
    [here, scale],
  );

  const seedNow = useCallback(async (): Promise<CardSeed | null> => {
    const seed = seeded.current;
    if (!seed || !data) return null;
    const draft = await readFrontValue<CardDraft>(draftKey(seed.requestId, seed.path));
    return {
      ...seed,
      view: data.view,
      collapsed: data.collapsed,
      box: data.box,
      draft: draft?.dirty ? draft : undefined,
    };
  }, [data]);

  const dropped = useCallback(
    async (at: Point, grab: Point, force: boolean) => {
      const seed = await seedNow();
      if (!seed) return;
      await emit(CARD_DROPPED, { label, seed, at, grab, force } satisfies Dropped);
    },
    [label, seedNow],
  );

  const actions = useMemo<GraphActions>(
    () => ({
      ...NO_ACTIONS,
      closeFilePreview: () => void here.close().catch(() => undefined),
      saveFilePreview: async (_requestId, text, expected) => {
        if (!data || data.size === null || data.truncated) return false;
        try {
          const config = settingsDocument();
          const size =
            config?.path === data.path
              ? await writeSettingsText(text, expected ?? data.text ?? "")
              : await writeFile(data.path, text, data.size);
          setData((held) => held && { ...held, text, size });
          refreshChanges();
          return true;
        } catch {
          return false;
        }
      },
      collapseFilePreview: () => {
        if (!data) return;
        const collapsed = !data.collapsed;
        void size(data.box.width, collapsed ? folded(card.current, scale) : data.box.height);
        setData({ ...data, collapsed });
      },
      setFilePreviewView: (_requestId, view) => setData((held) => held && { ...held, view }),
      fitFilePreview: (_requestId, width, tall) => {
        if (!data) return;
        const height = tall ?? data.box.height;
        void size(width, data.collapsed ? folded(card.current, scale) : height);
        setData({ ...data, box: { width, height } });
      },
      // The pin on a card out here is the way back in.
      pinFilePreview: () => {
        void Promise.all([here.innerPosition(), here.scaleFactor()])
          .then(([position, factor]) =>
            dropped({ x: position.x / factor, y: position.y / factor }, { x: 0, y: 0 }, true),
          )
          .catch(() => undefined);
      },
    }),
    [data, dropped, here, scale, size],
  );

  const drag = useRef<{ grab: Point; move: (at: Point) => void } | null>(null);
  const onPointerDown = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (!target.closest(".page__header")) return;
      if (target.closest(".page__tool, button, select, input, label")) return;
      drag.current = { grab: { x: event.clientX, y: event.clientY }, move: mover(here) };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [here],
  );
  const onPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const held = drag.current;
    if (!held) return;
    held.move(corner({ x: event.screenX, y: event.screenY }, held.grab));
  }, []);
  const onPointerUp = useCallback(
    (event: PointerEvent<HTMLDivElement>) => {
      const held = drag.current;
      if (!held) return;
      drag.current = null;
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
      if (event.type === "pointercancel") return;
      void dropped({ x: event.screenX, y: event.screenY }, held.grab, false);
    },
    [dropped],
  );

  if (!data) return null;
  return (
    <GraphActionsProvider value={actions}>
      <div
        ref={card}
        className="card-window"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        style={{
          width: data.box.width,
          height: data.collapsed ? undefined : data.box.height,
          transform: `scale(${scale})`,
        }}
      >
        <FilePreviewCard data={data} />
      </div>
    </GraphActionsProvider>
  );
}

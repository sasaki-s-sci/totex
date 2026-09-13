import type { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * How long to give the window manager to do as it was asked before checking.
 *
 * Maximising is a request, not an instruction: the call comes back long before
 * the window has moved, and on some managers it never moves at all.
 */
const SETTLE_MS = 150;

/** Where the window was before it filled the screen, so it has a way back. */
type Rect = { position: PhysicalPosition; size: PhysicalSize };

/**
 * Filling the screen, and coming back off it — with the answer checked.
 *
 * The window is undecorated, so the system draws no frame for it and, on some
 * window managers, does not place it either: asked to maximise, it takes the
 * screen's size and keeps the position it already had, which leaves the window
 * hanging off the bottom right and a band of desktop showing along the top and
 * the left. Everything in that band belongs to whatever is behind the window,
 * so the marks drawn near those edges stop answering.
 *
 * The system is still asked first — it knows about taskbars, snapping and
 * several screens, and none of that is worth reimplementing — but the result is
 * measured against the screen's work area, and the window is placed by hand
 * only when the answer came back wrong. Where the system gets it right, which
 * includes a maximised window that deliberately overhangs its screen by the
 * width of the resize frame, nothing here does anything at all.
 */
export function useWindowFill() {
  const appWindow = useMemo(() => getCurrentWindow(), []);
  const [filling, setFilling] = useState(false);
  // Only set when the window had to be placed by hand, because that is the case
  // where the system has nothing of its own to put back.
  const held = useRef<Rect | null>(null);

  /** The window's own rectangle, and the room it is meant to fill. */
  const measure = useCallback(async () => {
    const [position, size, monitor] = await Promise.all([
      appWindow.outerPosition(),
      appWindow.outerSize(),
      currentMonitor(),
    ]);
    return { position, size, area: monitor?.workArea ?? null };
  }, [appWindow]);

  /** Whether the window covers every part of the screen it is meant to. */
  const covers = useCallback(async () => {
    const { position, size, area } = await measure();
    if (!area) return false;
    return (
      position.x <= area.position.x &&
      position.y <= area.position.y &&
      position.x + size.width >= area.position.x + area.size.width &&
      position.y + size.height >= area.position.y + area.size.height
    );
  }, [measure]);

  const read = useCallback(async () => {
    // Either answer means the mark should offer to put the window back: one is
    // the system's own idea of maximised, the other is a window that fills the
    // screen because it was placed there.
    const [maximised, filled] = await Promise.all([appWindow.isMaximized(), covers()]);
    setFilling(maximised || filled);
  }, [appWindow, covers]);

  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;
    let asking = false;

    // Dragging an edge emits a resize per frame, and each answer is a crossing
    // into the backend: one question at a time, and the last frame's answer is
    // the one that lands.
    const ask = () => {
      if (asking) return;
      asking = true;
      read()
        .catch(() => undefined)
        .finally(() => {
          asking = false;
        });
    };

    ask();
    // The window can be filled from the keyboard or by the system as well as
    // from here, so the mark follows the window rather than the last click.
    appWindow
      .onResized(ask)
      .then((off) => {
        if (cancelled) off();
        else stop = off;
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [appWindow, read]);

  const toggle = useCallback(async () => {
    try {
      if (filling) {
        const back = held.current;
        held.current = null;
        await appWindow.unmaximize();
        // A window that was placed by hand was never maximised as far as the
        // system is concerned, so what it puts back is not what was there — the
        // manager that gets the position wrong on the way in gets it wrong on
        // the way out too. This is where the window actually came from.
        if (back) {
          await new Promise((done) => setTimeout(done, SETTLE_MS));
          await appWindow.setPosition(back.position);
          await appWindow.setSize(back.size);
        }
      } else {
        const before = await measure();
        await appWindow.maximize();
        await new Promise((done) => setTimeout(done, SETTLE_MS));

        const { area } = await measure();
        if (area && !(await covers())) {
          held.current = { position: before.position, size: before.size };
          await appWindow.setPosition(area.position);
          await appWindow.setSize(area.size);
        }
      }
    } catch {
      // A window that refused to move is still a window; the mark re-reads it
      // below and says whatever is true now.
    }
    await read().catch(() => undefined);
  }, [appWindow, covers, filling, measure, read]);

  return { filling, toggle };
}

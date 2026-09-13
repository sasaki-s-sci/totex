import type { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Maximising is a request: the call returns before the window moves, and on some managers it never
// moves.
const SETTLE_MS = 150;

type Rect = { position: PhysicalPosition; size: PhysicalSize };

/**
 * Some window managers give an undecorated window the screen's size but keep its position; the
 * result is measured and the window placed by hand only when wrong.
 */
export function useWindowFill() {
  const appWindow = useMemo(() => getCurrentWindow(), []);
  const [filling, setFilling] = useState(false);
  // Only set when placed by hand: then the system has nothing of its own to put back.
  const held = useRef<Rect | null>(null);

  const measure = useCallback(async () => {
    const [position, size, monitor] = await Promise.all([
      appWindow.outerPosition(),
      appWindow.outerSize(),
      currentMonitor(),
    ]);
    return { position, size, area: monitor?.workArea ?? null };
  }, [appWindow]);

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
    const [maximised, filled] = await Promise.all([appWindow.isMaximized(), covers()]);
    setFilling(maximised || filled);
  }, [appWindow, covers]);

  useEffect(() => {
    let cancelled = false;
    let stop: (() => void) | undefined;
    let asking = false;

    // One question at a time: a drag emits a resize per frame.
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
    // The mark follows the window, not the last click.
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
        // A window placed by hand was never maximised as far as the system knows, so this is where
        // it came from.
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
    } catch {}
    await read().catch(() => undefined);
  }, [appWindow, covers, filling, measure, read]);

  return { filling, toggle };
}

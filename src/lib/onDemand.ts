import { type ComponentType, useEffect, useRef, useSyncExternalStore } from "react";
import { notifications } from "./notifications";

// biome-ignore lint/suspicious/noExplicitAny: how React types `lazy` itself — the props are the module's own
type Drawable = ComponentType<any>;

export interface Part<T extends Drawable> {
  warm: () => Promise<unknown>;
  use: (wanted?: boolean) => T | null;
}

export function onDemand<T extends Drawable>(load: () => Promise<T>): Part<T> {
  let held: T | null = null;
  let started: Promise<unknown> | null = null;
  const changes = notifications();

  const warm = () => {
    started ??= load()
      .then((part) => {
        held = part;
        changes.notify();
        return part;
      })
      .catch((cause) => {
        // A failed load is asked for again the next time it is wanted.
        started = null;
        throw cause;
      });
    return started;
  };

  // A hook rather than `lazy`: a lazy part already in hand still costs React a thrown-away
  // render, so the canvas would arrive a commit late. Not wanted reads as null, so an
  // arrival re-renders only what waited for it.
  const usePart = (wanted = true) => {
    const part = useSyncExternalStore(
      changes.subscribe,
      () => (wanted ? held : null),
      () => null,
    );
    useEffect(() => {
      if (wanted) warm().catch(() => undefined);
    }, [wanted]);
    return part;
  };

  return { warm, use: usePart };
}

/**
 * In turn, not at once: each parse runs on the drawing thread. The idle timeout keeps a busy window
 * from never getting them.
 */
export function warmInTurn(parts: readonly { warm: () => Promise<unknown> }[]): () => void {
  let handle = 0;
  let stopped = false;

  const next = (index: number) => {
    if (stopped || index >= parts.length) return;
    handle = idle(() => {
      parts[index]
        .warm()
        .catch(() => undefined)
        .finally(() => next(index + 1));
    });
  };

  next(0);
  return () => {
    stopped = true;
    cancelIdle(handle);
  };
}

// Safari still has no requestIdleCallback.
const asks = typeof window.requestIdleCallback === "function";

const idle = (run: () => void): number =>
  asks ? window.requestIdleCallback(run, { timeout: 1000 }) : window.setTimeout(run, 200);

const cancelIdle = (handle: number): void => {
  if (asks) window.cancelIdleCallback(handle);
  else window.clearTimeout(handle);
};

/**
 * True from the first render it is wanted, and from then on: a part unmounted the frame its menu
 * closes would vanish instead of fading.
 */
export function useEver(wanted: boolean): boolean {
  const asked = useRef(false);
  asked.current ||= wanted;
  return asked.current;
}

import { type ComponentType, useEffect, useSyncExternalStore } from "react";
import { notifications } from "./notifications";

// biome-ignore lint/suspicious/noExplicitAny: how React types `lazy` itself — the props are the module's own
type Drawable = ComponentType<any>;

/**
 * A part of the window that is fetched when it is first wanted.
 *
 * Everything this window can show was in one file, and a window that has just
 * opened shows one of them: the folder column. A terminal is four hundred
 * kilobytes of emulator that most sessions never open, a canvas is a graph
 * engine, and each menu or page has controls — all fetched before the first pixel,
 * on the way to a column of folder names.
 *
 * So each of them is asked for instead, and `warm` is how they are paid for out
 * of an idle moment rather than out of the click that wants them.
 */
export interface Part<T extends Drawable> {
  /** Fetches it now, if it is not already here or on its way. */
  warm: () => Promise<unknown>;
  /**
   * The part, or null until it has arrived. Wanting it is what fetches it.
   *
   * A hook rather than `lazy` behind a boundary, because of what happens on the
   * frame it is first drawn: a lazy component hands React a promise and React
   * throws that render away, even when the promise is already holding the
   * answer — so the canvas would arrive a commit late every time, however early
   * it had been fetched. Held here instead, a part that is already in hand is
   * drawn in the same commit as whatever asked for it.
   *
   * `wanted` is what keeps that cheap: a part nobody is asking for reads as
   * null whether it has arrived or not, so its arrival re-renders only what was
   * waiting for it.
   */
  use: (wanted?: boolean) => T | null;
}

export function onDemand<T extends Drawable>(load: () => Promise<T>): Part<T> {
  let held: T | null = null;
  let started: Promise<unknown> | null = null;
  const changes = notifications();

  const warm = () => {
    // The same promise every time: `warm` and a first draw are two ways of
    // asking for one chunk, and a second import would be a second parse of it.
    started ??= load()
      .then((part) => {
        held = part;
        changes.notify();
        return part;
      })
      .catch((cause) => {
        // A part that would not load is asked for again the next time it is
        // wanted, rather than being written off for the life of the window.
        started = null;
        throw cause;
      });
    return started;
  };

  const usePart = (wanted = true) => {
    const part = useSyncExternalStore(
      changes.subscribe,
      () => (wanted ? held : null),
      () => null,
    );
    useEffect(() => {
      // Nothing is done with the failure here: the part simply is not drawn,
      // and asking for it again is what tries again.
      if (wanted) warm().catch(() => undefined);
      // `warm` is this part's own, and never another: it is closed over here
      // rather than listed, so that the dependency is `wanted` and nothing else.
    }, [wanted]);
    return part;
  };

  return { warm, use: usePart };
}

/**
 * Fetches parts one at a time, in whatever room the window has to spare.
 *
 * In turn rather than all at once: each of these is parsed and evaluated on the
 * same thread the window is drawn on, so three of them asked for together are
 * one long stall instead of three short ones the browser can fit between
 * frames. The order is what is most likely to be wanted first.
 *
 * The timeout is what keeps it from being indefinite — a window that is being
 * typed into never goes idle, and the point is to have these in hand before
 * they are clicked, not to wait for a lull that may never come. A second is
 * about as long as the quietest of these can be left: the terminal is fetched
 * from the moment a canvas is drawn, and what it is fetched for is a button on
 * that canvas.
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

/** Whether the browser will say when it has a moment. Safari still will not. */
const asks = typeof window.requestIdleCallback === "function";

const idle = (run: () => void): number =>
  asks ? window.requestIdleCallback(run, { timeout: 1000 }) : window.setTimeout(run, 200);

const cancelIdle = (handle: number): void => {
  if (asks) window.cancelIdleCallback(handle);
  else window.clearTimeout(handle);
};

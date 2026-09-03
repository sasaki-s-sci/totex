/**
 * How far the canvas goes to bring what the cursor keys reached into view.
 *
 * A walk is read in two places at once: the mark that is lit, and the canvas
 * around it. Those two want opposite things. Somebody stepping along a history
 * to find one commit wants the canvas to follow, and somebody who has laid the
 * window out the way they want it read wants it to hold still — a canvas that
 * jumps under a key is a canvas whose shape has to be found again after every
 * press.
 *
 * So it is a choice of three, and the middle one is what the window has always
 * done: move only when the walk has gone as far as the edge, which is the least
 * that keeps the pick from walking off screen. Kept beside the theme and the
 * language rather than in the backend, for the same reason those are — it is a
 * fact about this window and not about any repository.
 */

import { useSyncExternalStore } from "react";

/** Where the choice is kept. Its absence means the middle of the three. */
export const REVEAL_KEY = "totex.reveal";

/**
 * The three, in the order they are offered: not at all, when the walk has
 * reached the edge of the pane, and every step.
 */
export type Reveal = "never" | "edge" | "centre";

export const REVEALS: readonly Reveal[] = ["never", "edge", "centre"];

/** What a window nobody has told does, which is what every window did before
 *  there was anything to tell it. */
const DEFAULT: Reveal = "edge";

function stored(): Reveal {
  try {
    const held = localStorage.getItem(REVEAL_KEY);
    // Anything else written there — an older word, or a hand — is a window that
    // was never told, rather than a window that follows nothing.
    return REVEALS.find((option) => option === held) ?? DEFAULT;
  } catch {
    // A webview with no storage at all is a window nobody has told.
    return DEFAULT;
  }
}

let following = stored();

const waiting = new Set<() => void>();

/** How far the canvas goes, without subscribing to it: the walk reads it at
 *  every step, and a walk is not a thing to re-render the window for. */
export function revealing(): Reveal {
  return following;
}

export function setRevealing(next: Reveal): void {
  if (next === following) return;
  following = next;
  try {
    localStorage.setItem(REVEAL_KEY, next);
  } catch {
    // The choice still holds for as long as this window is open. Nothing is
    // worth saying about a preference that will not be remembered.
  }
  for (const wake of waiting) wake();
}

const listen = (wake: () => void) => {
  waiting.add(wake);
  return () => {
    waiting.delete(wake);
  };
};

export function useRevealing(): Reveal {
  return useSyncExternalStore(listen, revealing, revealing);
}

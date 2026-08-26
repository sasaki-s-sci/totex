/**
 * Whether the window keeps its branches up with their remotes on its own.
 *
 * Kept beside the theme and the language rather than in the backend: it is a
 * fact about this window and not about any repository, and it has to be true
 * from the moment the app starts — the round runs whether or not the settings
 * page has ever been opened, which is the whole point of it.
 *
 * A store rather than a value read where it is wanted, because two things read
 * it and they must agree: the checkbox that is drawn from it, and the round
 * that starts and stops the moment it is pressed.
 */

import { useSyncExternalStore } from "react";

/** Where the choice is kept. Its absence means the window follows nothing. */
export const FOLLOW_KEY = "totex.follow";

/**
 * What is written down, spelled as a word rather than as a flag.
 *
 * A key that is absent and a key that says `off` mean the same thing here, and
 * a window that has never been told is a window that does not go near anybody's
 * network on its own.
 */
const ON = "on";

function stored(): boolean {
  try {
    return localStorage.getItem(FOLLOW_KEY) === ON;
  } catch {
    // A webview with no storage at all is a window that follows nothing, which
    // is the same answer as one that was never asked.
    return false;
  }
}

let following = stored();

const waiting = new Set<() => void>();

/** Whether the window is following, without subscribing to it. */
export function isFollowing(): boolean {
  return following;
}

export function setFollowing(next: boolean): void {
  if (next === following) return;
  following = next;
  try {
    localStorage.setItem(FOLLOW_KEY, next ? ON : "off");
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

export function useFollowing(): boolean {
  return useSyncExternalStore(listen, isFollowing, isFollowing);
}

/**
 * Whether the canvas keeps the lines on without being asked.
 *
 * What each terminal was last told to do is drawn beside its mark while Ctrl is
 * held — see `useCliTyped`, and `cliTyped` for what the line is for. Held
 * rather than kept, because the reading costs a walk of every running session
 * and because a canvas of terminals is meant to be read as places rather than
 * as a list of labels. But a window with three terminals open on three
 * different things is a window where those labels are the point, and somebody
 * working that way should not have to hold a key to see it. So it is a choice,
 * and it is off until it is made: what the window does out of the box is what
 * it always did.
 *
 * Kept beside the theme and the language rather than in the backend, for the
 * same reason those are: it is a fact about this window and not about any
 * repository. A store rather than a value read where it is wanted, because two
 * things read it and they must agree — the checkbox that is drawn from it, and
 * the canvas that starts and stops asking the moment it is pressed.
 */

import { useSyncExternalStore } from "react";

/** Where the choice is kept. Its absence means the lines wait for the key. */
export const SAID_KEY = "totex.said";

/** What is written down, spelled as a word rather than as a flag. */
const ON = "on";

function stored(): boolean {
  try {
    return localStorage.getItem(SAID_KEY) === ON;
  } catch {
    // A webview with no storage at all is a window nobody has told, which is a
    // window that draws these while Ctrl is held and not otherwise.
    return false;
  }
}

let showing = stored();

const waiting = new Set<() => void>();

/** Whether the lines are being kept on, without subscribing to it. */
export function isShowingSaid(): boolean {
  return showing;
}

export function setShowingSaid(next: boolean): void {
  if (next === showing) return;
  showing = next;
  try {
    localStorage.setItem(SAID_KEY, next ? ON : "off");
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

export function useShowingSaid(): boolean {
  return useSyncExternalStore(listen, isShowingSaid, isShowingSaid);
}

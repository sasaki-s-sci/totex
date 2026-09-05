/**
 * The line beside a terminal: whether the canvas keeps it on, and how it is set.
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
 * And once the lines are on all the time they are being read rather than
 * glanced at, which is a different thing to ask of a nine-pixel line cut off at
 * two hundred and twenty pixels. So how they are set is a choice too: the face,
 * the size, how many lines one may take and how wide it may be. One set of
 * measures for all of them rather than one apiece, for the reason
 * `useReadingSize` is one size for every file card — it is the reader's
 * eyesight being answered, not this terminal's.
 *
 * The last of them is not a measure but a way of arriving at two: with `fitting`
 * on, the width and the line count are taken from the canvas itself rather than
 * from what was typed here. See `useSaidStyle`.
 *
 * Kept beside the theme and the language rather than in the backend, for the
 * same reason those are: it is a fact about this window and not about any
 * repository. A store rather than a value read where it is wanted, because two
 * things read it and they must agree — the page that is drawn from it, and the
 * canvas that answers the moment it is pressed.
 */

import { useSyncExternalStore } from "react";
import { notifications } from "./notifications";

/** Which face a line is set in. */
export type SaidFace =
  /** The terminal's own, which is where the words came from. */
  | "terminal"
  /** The window's, which is what everything else on the canvas is set in. */
  | "window";

/** How the lines are drawn, and whether they are drawn without being asked. */
export type Said = {
  /** Whether they stand without Ctrl being held. */
  showing: boolean;
  face: SaidFace;
  /** How large, in pixels. */
  size: number;
  /** How many lines one may run to before what is left is cut off. */
  lines: number;
  /** How wide it may be, in pixels on the canvas's own scale. */
  width: number;
  /** Whether the last two are the canvas's to decide rather than these. */
  fitting: boolean;
};

/**
 * The room each measure has, and what a window that has never been told uses.
 *
 * `size` starts where the stylesheet had it, and so do `width` and `lines`:
 * whatever else changes here, a window that opens this page and closes it again
 * is drawing exactly what it drew before.
 */
export const SIZE = { least: 7, most: 20, start: 9 } as const;
export const LINES = { least: 1, most: 6, start: 1 } as const;
export const WIDTH = { least: 80, most: 640, start: 220 } as const;

/** Where each choice is kept. The first is the one that was here before. */
const KEYS = {
  showing: "totex.said",
  face: "totex.said.face",
  size: "totex.said.size",
  lines: "totex.said.lines",
  width: "totex.said.width",
  fitting: "totex.said.fit",
} as const;

/** What a yes is written down as, spelled as a word rather than as a flag. */
const ON = "on";

function held(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    // A webview with no storage at all is a window nobody has told, which is a
    // window drawing what it always drew.
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // The choice still holds for as long as this window is open. Nothing is
    // worth saying about a preference that will not be remembered.
  }
}

function clamp(value: number, room: { least: number; most: number }): number {
  return Math.min(room.most, Math.max(room.least, Math.round(value)));
}

/** A number as it was written down, or the start where it was not a number. */
function number(key: string, room: { least: number; most: number; start: number }): number {
  const written = Number(held(key));
  return Number.isFinite(written) && written > 0 ? clamp(written, room) : room.start;
}

function stored(): Said {
  return {
    showing: held(KEYS.showing) === ON,
    face: held(KEYS.face) === "window" ? "window" : "terminal",
    size: number(KEYS.size, SIZE),
    lines: number(KEYS.lines, LINES),
    width: number(KEYS.width, WIDTH),
    fitting: held(KEYS.fitting) === ON,
  };
}

let said = stored();

const changes = notifications();

/** How the lines are set, without subscribing to it. */
export function saidNow(): Said {
  return said;
}

/**
 * Sets whichever of them was named, and leaves the rest where they are.
 *
 * The whole record is replaced rather than changed in place, because what is
 * handed out is read by `useSyncExternalStore` and a record it has already seen
 * is a record it will not redraw for.
 */
export function setSaid(next: Partial<Said>): void {
  const before = said;
  const after: Said = { ...before, ...next };
  if (
    after.showing === before.showing &&
    after.face === before.face &&
    after.size === before.size &&
    after.lines === before.lines &&
    after.width === before.width &&
    after.fitting === before.fitting
  ) {
    return;
  }

  said = after;
  if (after.showing !== before.showing) write(KEYS.showing, after.showing ? ON : "off");
  if (after.face !== before.face) write(KEYS.face, after.face);
  if (after.size !== before.size) write(KEYS.size, String(after.size));
  if (after.lines !== before.lines) write(KEYS.lines, String(after.lines));
  if (after.width !== before.width) write(KEYS.width, String(after.width));
  if (after.fitting !== before.fitting) write(KEYS.fitting, after.fitting ? ON : "off");
  changes.notify();
}

export function useSaid(): Said {
  return useSyncExternalStore(changes.subscribe, saidNow, saidNow);
}

/** Whether the lines are being kept on, without subscribing to it. */
export function isShowingSaid(): boolean {
  return said.showing;
}

export function useShowingSaid(): boolean {
  return useSyncExternalStore(changes.subscribe, isShowingSaid, isShowingSaid);
}

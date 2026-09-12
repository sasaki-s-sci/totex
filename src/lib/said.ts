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
 * Stored in the application settings document alongside theme and language.
 */

import { useSyncExternalStore } from "react";
import { settingsNow, subscribeSettings, updateSettings } from "./appSettings";

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
  /**
   * How solid they are while they stand, in percent. The page offers this and
   * `showing` as one slider — nought is off, and anything above it is on at
   * that strength — because a line kept on all day is a line somebody may
   * want fainter than a line glanced at, and how faint is a matter of degree
   * that begins at not there.
   */
  opacity: number;
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
export const SIZE = { least: 1, most: 20, start: 9 } as const;
export const OPACITY = { least: 1, most: 100, start: 100 } as const;
export const LINES = { least: 1, most: 6, start: 1 } as const;
export const WIDTH = { least: 80, most: 640, start: 220 } as const;

/** The same live document is read by the form and the canvas. */
export function saidNow(): Said {
  return settingsNow().said;
}
export function setSaid(next: Partial<Said>): void {
  updateSettings({ said: next });
}

/**
 * The lines as one number, the way the page offers them: nought when they are
 * not kept on, and how solid they are when they are.
 */
export function saidStrength(said: Said): number {
  return said.showing ? said.opacity : 0;
}

/** The one number back into the two it stands for. Nought turns the lines off
 *  and leaves how solid they were alone, so turning them back on is one move. */
export function setSaidStrength(strength: number): void {
  setSaid(strength > 0 ? { showing: true, opacity: strength } : { showing: false });
}
export function useSaid(): Said {
  return useSyncExternalStore(subscribeSettings, saidNow, saidNow);
}
export function isShowingSaid(): boolean {
  return saidNow().showing;
}
export function useShowingSaid(): boolean {
  return useSyncExternalStore(subscribeSettings, isShowingSaid, isShowingSaid);
}

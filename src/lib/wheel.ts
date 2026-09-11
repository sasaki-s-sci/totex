/**
 * How far one notch of the wheel goes, in each of the two places it is heard.
 *
 * A terminal scrolls on it and the canvas zooms on it, and neither of the two
 * has a distance of its own: xterm scrolls by what the browser reports and the
 * canvas by what d3-zoom always did. Both are a fair start and neither is right
 * for every hand — a mouse that reports a hundred pixels a notch on Windows is
 * a very different thing from a trackpad — so each is a percentage of what it
 * was, one for the terminals and one for the canvas, because a hand that wants
 * the scrollback to fly does not thereby want the graph to lurch.
 *
 * Stored in the application settings document alongside theme and language.
 */

import { useSyncExternalStore } from "react";
import { settingsNow, subscribeSettings } from "./appSettings";

/** The two places the wheel is heard. */
export type WheelPlace = "cli" | "graph";

/** The room the percentage has, and what a window that has never been told uses. */
export const WHEEL = { least: 25, most: 400, start: 100 } as const;

/** How far apart the numbers offered are: a quarter of the way is the least
 *  difference a hand notices. */
export const WHEEL_STEP = 25;

const KEYS = { cli: "cliWheel", graph: "graphWheel" } as const;

/** The percentage itself, as the settings page shows it. */
export function wheelNow(place: WheelPlace): number {
  return settingsNow()[KEYS[place]];
}

/** What a distance is multiplied by, read at the moment the wheel turns. */
export function wheelFactor(place: WheelPlace): number {
  return wheelNow(place) / 100;
}

export function useWheel(place: WheelPlace): number {
  const read = () => wheelNow(place);
  return useSyncExternalStore(subscribeSettings, read, read);
}

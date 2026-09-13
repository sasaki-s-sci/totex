import { useSyncExternalStore } from "react";
import { settingsNow, subscribeSettings } from "./appSettings";

export type WheelPlace = "cli" | "graph";

export const WHEEL = { least: 25, most: 400, start: 100 } as const;

export const WHEEL_STEP = 25;

const KEYS = { cli: "cliWheel", graph: "graphWheel" } as const;

export function wheelNow(place: WheelPlace): number {
  return settingsNow()[KEYS[place]];
}

export function wheelFactor(place: WheelPlace): number {
  return wheelNow(place) / 100;
}

export function useWheel(place: WheelPlace): number {
  const read = () => wheelNow(place);
  return useSyncExternalStore(subscribeSettings, read, read);
}

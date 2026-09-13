import { useSyncExternalStore } from "react";
import { settingsNow, subscribeSettings, updateSettings } from "./appSettings";

export type SaidFace = "terminal" | "window";

export type Said = {
  showing: boolean;
  opacity: number;
  face: SaidFace;
  size: number;
  lines: number;
  width: number;
  /** Width and lines come from the canvas instead — see `useSaidStyle`. */
  fitting: boolean;
};

export const SIZE = { least: 1, most: 20, start: 9 } as const;
export const OPACITY = { least: 1, most: 100, start: 100 } as const;
export const LINES = { least: 1, most: 6, start: 1 } as const;
export const WIDTH = { least: 80, most: 640, start: 220 } as const;

export function saidNow(): Said {
  return settingsNow().said;
}
export function setSaid(next: Partial<Said>): void {
  updateSettings({ said: next });
}

/** The page offers `showing` and `opacity` as one slider: zero is off. */
export function saidStrength(said: Said): number {
  return said.showing ? said.opacity : 0;
}

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

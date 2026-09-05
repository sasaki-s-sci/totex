/** How far the canvas follows keyboard navigation. */
import { useSyncExternalStore } from "react";
import { settingsNow, subscribeSettings, updateSettings } from "./appSettings";
export type Reveal = "never" | "edge" | "centre";
export const REVEALS: readonly Reveal[] = ["never", "edge", "centre"];
export function revealing(): Reveal {
  return settingsNow().reveal;
}
export function setRevealing(next: Reveal): void {
  updateSettings({ reveal: next });
}
export function useRevealing(): Reveal {
  return useSyncExternalStore(subscribeSettings, revealing, revealing);
}

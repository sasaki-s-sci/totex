import { useSyncExternalStore } from "react";
import { settingsNow, subscribeSettings, updateSettings } from "./appSettings";

export function isKeepingSpare(): boolean {
  return settingsNow().spareWorktree;
}
export function setKeepingSpare(next: boolean): void {
  updateSettings({ spareWorktree: next });
}
export function useKeepingSpare(): boolean {
  return useSyncExternalStore(subscribeSettings, isKeepingSpare, isKeepingSpare);
}

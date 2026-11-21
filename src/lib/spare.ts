import { useSyncExternalStore } from "react";
import { settingsNow, subscribeSettings } from "./appSettings";

export function isKeepingSpare(): boolean {
  return settingsNow().spareWorktree;
}
export function useKeepingSpare(): boolean {
  return useSyncExternalStore(subscribeSettings, isKeepingSpare, isKeepingSpare);
}

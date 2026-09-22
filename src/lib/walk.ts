import { useSyncExternalStore } from "react";
import { settingsNow, subscribeSettings, updateSettings } from "./appSettings";

export function isWrapping(): boolean {
  return settingsNow().walkWrap;
}
export function setWrapping(next: boolean): void {
  updateSettings({ walkWrap: next });
}
export function useWrapping(): boolean {
  return useSyncExternalStore(subscribeSettings, isWrapping, isWrapping);
}

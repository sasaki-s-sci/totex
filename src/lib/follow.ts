import { useSyncExternalStore } from "react";
import { settingsNow, subscribeSettings } from "./appSettings";

export function isFollowing(): boolean {
  return settingsNow().follow;
}
export function useFollowing(): boolean {
  return useSyncExternalStore(subscribeSettings, isFollowing, isFollowing);
}

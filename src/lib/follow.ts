import { useSyncExternalStore } from "react";
import { settingsNow, subscribeSettings, updateSettings } from "./appSettings";
import { notifications } from "./notifications";

export function isFollowing(): boolean {
  return settingsNow().follow;
}
export function setFollowing(next: boolean): void {
  updateSettings({ follow: next });
}
export function useFollowing(): boolean {
  return useSyncExternalStore(subscribeSettings, isFollowing, isFollowing);
}

export type Fetching = "rest" | "asking" | "failed";

let fetching: Fetching = "rest";

const fetchingChanges = notifications();

const rounds = new Set<() => void>();

export function isFetching(): Fetching {
  return fetching;
}

export function sayFetching(next: Fetching): void {
  if (next === fetching) return;
  fetching = next;
  fetchingChanges.notify();
}

export function useFetching(): Fetching {
  return useSyncExternalStore(fetchingChanges.subscribe, isFetching, isFetching);
}

/** One listener only: a second would be a second round over the same repositories. */
export function onFetchAsked(run: () => void): () => void {
  rounds.add(run);
  return () => {
    rounds.delete(run);
  };
}

export function askFetch(): void {
  // No round registered yet means nothing asked, not a button left busy.
  if (rounds.size === 0) return;
  sayFetching("asking");
  for (const run of rounds) run();
}

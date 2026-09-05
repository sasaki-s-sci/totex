/**
 * The window and the remotes it follows: whether it does so on its own, and the
 * press that asks it to now.
 *
 * The preference lives in the application settings document.
 *
 * The press is here for the opposite reason. The round lives with the window,
 * because that is where the repositories are; the button lives on a page on the
 * canvas, which may never be opened and knows about no repository at all. So
 * the two are put in touch through this, the way the checkbox and the round
 * already are — see `askFetch`.
 */

import { useSyncExternalStore } from "react";
import { settingsNow, subscribeSettings, updateSettings } from "./appSettings";
import { notifications } from "./notifications";

/** The preference is shared with the settings document. */
export function isFollowing(): boolean {
  return settingsNow().follow;
}
export function setFollowing(next: boolean): void {
  updateSettings({ follow: next });
}
export function useFollowing(): boolean {
  return useSyncExternalStore(subscribeSettings, isFollowing, isFollowing);
}

/**
 * What a round somebody pressed for is doing, which is the whole of what the
 * button on the settings page draws itself from.
 *
 * `failed` is a remote that would not answer. It is a resting state rather than
 * a moment, because the press it belongs to is over: the button wears it until
 * it is pressed again, which is what a red button on this page means everywhere
 * else — see the one that takes an update.
 */
export type Fetching = "rest" | "asking" | "failed";

let fetching: Fetching = "rest";

/** Drawn from `fetching`, which is what the button is. */
const fetchingChanges = notifications();

/** The round itself, which is the only thing that can actually go and ask. */
const rounds = new Set<() => void>();

export function isFetching(): Fetching {
  return fetching;
}

/**
 * Said by the round as it goes and as it ends. Nothing else writes it: the
 * button asks, and what became of the asking is the round's to say.
 */
export function sayFetching(next: Fetching): void {
  if (next === fetching) return;
  fetching = next;
  fetchingChanges.notify();
}

export function useFetching(): Fetching {
  return useSyncExternalStore(fetchingChanges.subscribe, isFetching, isFetching);
}

/**
 * Registered by the round, which is the half of this that has the repositories.
 * Nothing else may: a second listener would be a second round, over the same
 * repositories, at the same moment.
 */
export function onFetchAsked(run: () => void): () => void {
  rounds.add(run);
  return () => {
    rounds.delete(run);
  };
}

/**
 * The press. Says so before the round has started, because the button is being
 * looked at and a press that draws nothing for a second is a press somebody
 * makes twice.
 */
export function askFetch(): void {
  // Nothing to ask with is nothing asked, rather than a button left saying it
  // is busy forever. The round lives with the window, so this is only true
  // before the first render of it.
  if (rounds.size === 0) return;
  sayFetching("asking");
  for (const run of rounds) run();
}

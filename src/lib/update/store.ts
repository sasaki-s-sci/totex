/**
 * Held for the window rather than for the dialog.
 *
 * The settings dialog unmounts when it closes, and a release that has been
 * downloaded is waiting for a restart that may be minutes away. The list of
 * versions is here for the same reason from the other end: it is filled by a
 * poll that runs whether the dialog is open or not.
 */

import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";
import type { Half, Press, Standing, UpdateStage, UpdateState } from "./model";

const RESTING: Press = { stage: "rest", progress: null, version: null };

/**
 * Held for the window rather than for the dialog.
 *
 * The settings dialog unmounts when it closes, and a release that has been
 * downloaded is waiting for a restart that may be minutes away — closing the
 * dialog in between must not forget that, or the next press downloads the same
 * release again. The list of versions is here for the same reason from the
 * other end: it is filled by a poll that runs whether the dialog is open or
 * not, so that a pull-down is full when it is opened rather than after. It is
 * the same store `onDemand` keeps its parts in.
 */
export let state: UpdateState = {
  standing: null,
  versions: [],
  picked: null,
  front: RESTING,
  whole: RESTING,
};

const waiting = new Set<() => void>();

export function settle(change: Partial<UpdateState>): void {
  state = { ...state, ...change };
  for (const wake of waiting) wake();
}

/**
 * The same, for one of the two rows.
 *
 * Written out rather than keyed by the name, because a key that is a name held
 * in a variable is a key the type of the store cannot be checked against.
 */
export function settleHalf(half: Half, change: Partial<Press>): void {
  const press = { ...state[half], ...change };
  settle(half === "front" ? { front: press } : { whole: press });
}

const listen = (wake: () => void) => {
  waiting.add(wake);
  return () => {
    waiting.delete(wake);
  };
};

const read = () => state;

export function useUpdate(): UpdateState {
  return useSyncExternalStore(listen, read, read);
}

/** Which release both rows are pointed at: the one picked, or the newest. */
export function wanted(at: UpdateState): string | null {
  return at.picked ?? at.versions[0] ?? null;
}

/**
 * How one row reads, which is its own stage only while the two are about the
 * same release.
 *
 * A press made before the list of versions had arrived was a press for whatever
 * the release page said was newest, and the top of the list is what that turned
 * out to be — so it goes on reading as the same release when the list lands,
 * and stops only when somebody takes another one off the list by hand.
 */
export function stageOf(at: UpdateState, half: Half): UpdateStage {
  const press = at[half];
  const same = press.version === null ? at.picked === null : press.version === wanted(at);
  return same ? press.stage : "rest";
}

/** Takes a release off the pull-down, and leaves it there. */
export function pick(version: string): void {
  settle({ picked: version });
}

/**
 * Asks the backend what can be replaced here and what it is at.
 *
 * Asked once for the life of the window: which halves can be replaced is a
 * fact about how the app was installed, and neither version moves without a
 * reload or a restart. A copy that can have neither draws no update rows — see
 * `update.rs` for which those are.
 */
let asking: Promise<Standing> | null = null;

export function askStanding(): Promise<Standing> {
  asking ??= invoke<Standing>("update_standing").then(
    (standing) => {
      settle({ standing });
      return standing;
    },
    // A backend that will not answer is a window with no update rows, which is
    // the same thing an old copy of the app shows.
    () => {
      const none: Standing = { front: false, whole: false, running: "", drawn: "" };
      settle({ standing: none });
      return none;
    },
  );
  return asking;
}

/** How long the list of versions is left before it is asked for again. */
const EVERY = 30 * 60_000;

/**
 * Keeps the pull-down filled, from the moment the window opens.
 *
 * The one thing here that happens without a press. A list has to be full before
 * it is opened rather than after, and the release page is somebody else's
 * server: asking for it at the moment the pull-down is clicked would be a
 * pull-down that is empty for as long as that server takes. So it is asked for
 * on a slow loop instead — twice an hour, which is nothing beside a rate limit
 * and is far more often than releases are cut.
 *
 * Nothing is asked at all where nothing could be taken. A copy nobody installed
 * has no rows to fill a list for, and phoning a release page on its behalf
 * would be the window doing something on the person's network for no reason.
 *
 * An ask that fails leaves the list as it was: a version already offered is one
 * the release page had a moment ago, and a rate limit is not a reason to empty
 * a pull-down somebody is reading.
 */
export function watchVersions(): () => void {
  let alive = true;
  let again: ReturnType<typeof setTimeout> | undefined;

  const round = () => {
    invoke<string[]>("update_versions")
      .then((versions) => {
        if (alive && versions.length > 0) settle({ versions });
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) again = setTimeout(round, EVERY);
      });
  };

  void askStanding().then((standing) => {
    if (alive && (standing.front || standing.whole)) round();
  });

  return () => {
    alive = false;
    clearTimeout(again);
  };
}

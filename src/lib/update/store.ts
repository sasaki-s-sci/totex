/**
 * Held for the window rather than for the settings page.
 *
 * The settings page unmounts when it closes, while an automatic adjustment can
 * still be downloading. The compatible release list also starts filling when
 * the window opens rather than when the page is opened.
 *
 * What is *not* here is which release each row is pointed at. That is the
 * backend's — see `src-tauri/src/update/kept.rs` — because two of the three
 * layers are replaced while the app is running and neither of them is a place
 * anything can be kept. A row left on a version is on it again after the reload
 * that finishes the pages, after the layer underneath has been swapped, and
 * after the restart that finishes the program.
 */

import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";
import type { Cycle, Layer, Press, Rung, UpdateChoice, UpdateState } from "./model";

const RESTING: Press = { stage: "rest", progress: null, version: null };

export let state: UpdateState = {
  rungs: null,
  versions: { release: [], layer: [], front: [] },
  choices: [],
  presses: { front: RESTING, app: RESTING, core: RESTING },
};

const waiting = new Set<() => void>();

export function settle(change: Partial<UpdateState>): void {
  state = { ...state, ...change };
  for (const wake of waiting) wake();
}

/** The same, for one of the three physical layers. */
export function settlePress(layer: Layer, change: Partial<Press>): void {
  settle({ presses: { ...state.presses, [layer]: { ...state.presses[layer], ...change } } });
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

/** One row, or nothing where the backend has not said yet. */
export function rungOf(at: UpdateState, layer: Layer): Rung | null {
  return at.rungs?.find((rung) => rung.layer === layer) ?? null;
}

/** Whether one version is a later release than another. */
function ahead(one: string, than: string): boolean {
  const left = one.split(".").map(Number);
  const right = than.split(".").map(Number);
  for (let part = 0; part < Math.max(left.length, right.length); part += 1) {
    const a = left[part] ?? 0;
    const b = right[part] ?? 0;
    // Not `>`, so that a version that is not three numbers -- which is nothing
    // the release page offers, and could still be what this copy calls itself
    // -- never claims to be ahead of one that is.
    if (a !== b) return a > b;
  }
  return false;
}

/** The newer of two versions, either of which may be missing. */
export function newer(one: string | null, other: string | null): string | null {
  if (one === null) return other;
  if (other === null) return one;
  return ahead(other, one) ? other : one;
}

/**
 * Which release one row is pointed at: the one named, or the newest of the
 * cycle it is following.
 *
 * What is in place counts as one of the releases that cycle offers, so that
 * following it is a declaration to keep up rather than a declaration to move.
 * The three cycles are numbered apart from one another — a layer cut on its own
 * is at 0.1.11 while the app is at 0.1.17 — and without this the newest layer
 * there is reads as a step backwards from the layer inside the release that is
 * already here, which is exactly what it is not.
 *
 * A version named outright is left alone whichever way it points. That is what
 * naming one is for: the row that cannot go backwards is the row nobody told
 * where to go.
 */
export function wanted(at: UpdateState, layer: Layer): string | null {
  const rung = rungOf(at, layer);
  if (!rung) return null;
  if (rung.picked !== null) return rung.picked;
  return newer(at.versions[rung.cycle][0] ?? null, rung.at);
}

/**
 * How one row reads, which is its own stage only while it and the press are
 * about the same release.
 *
 * A press made before the list of releases had arrived was a press for whatever
 * the release page said was newest, and the top of the list is what that turned
 * out to be — so it goes on reading as the same release when the list lands, and
 * stops only when the row is moved to another one by hand.
 */
export function stageOf(at: UpdateState, layer: Layer): Press["stage"] {
  const press = at.presses[layer];
  const rung = rungOf(at, layer);
  const same = press.version === null ? !rung?.picked : press.version === wanted(at, layer);
  return same ? press.stage : "rest";
}

/**
 * Points one row at one release of one cycle, and has the backend remember it.
 *
 * `version` is null for "whichever compatible release is newest". Sync resolves
 * that moving declaration against the current listing before taking it.
 */
export async function declare(
  declarations: readonly { layer: Layer; cycle: Cycle; version: string | null }[],
): Promise<void> {
  try {
    for (const { layer, cycle, version } of declarations) {
      const rung = rungOf(state, layer);
      if (rung && rung.cycle !== cycle) await invoke("update_follow", { layer, cycle });
      await invoke("update_pick", { layer, version });
    }
  } catch {
    // A backend that will not remember what a row was left on is one where
    // the rows are read back as they were. Nothing else here is worth saying:
    // this is a preference, and the window is about to ask what it is anyway.
  }
  await askStanding(true);
}

/**
 * Asks the backend what can be replaced here and what each layer is at.
 *
 * Asked again after every press rather than once for the life of the window,
 * because one of the three moves without either a reload or a restart: a layer
 * that has just been taken is answering questions already, and the row has to
 * say so.
 */
let asking: Promise<Rung[]> | null = null;

export function askStanding(again = false): Promise<Rung[]> {
  if (again) asking = null;
  asking ??= invoke<Rung[]>("update_standing").then(
    (rungs) => {
      settle({ rungs });
      return rungs;
    },
    // A backend that will not answer is a window with no update rows, which is
    // the same thing an old copy of the app shows.
    () => {
      settle({ rungs: [] });
      return [];
    },
  );
  return asking;
}

/** How long the list of releases is left before it is asked for again. */
const EVERY = 30 * 60_000;

/**
 * Keeps both version declarations filled, from the moment the window opens.
 *
 * The one thing here that happens without a press. A list has to be full before
 * it is opened rather than after, and the release page is somebody else's
 * server: asking for it at the moment a pull-down is clicked would be a
 * pull-down that is empty for as long as that server takes. So it is asked for
 * on a slow loop instead — twice an hour, which is nothing beside a rate limit
 * and is far more often than releases are cut.
 *
 * The Core and full-release cycles are asked for at once because they are tags
 * on one repository. Their manifests add the compatibility terms the listing
 * itself does not carry.
 *
 * Nothing is asked at all where nothing could be taken. A copy nobody installed
 * has no rows to fill a list for, and phoning a release page on its behalf
 * would be the window doing something on the person's network for no reason.
 *
 * An ask that fails leaves the lists as they were: a version already offered is
 * one the release page had a moment ago, and a rate limit is not a reason to
 * empty a pull-down somebody is reading.
 */
export function watchUpdateChoices(): () => void {
  let alive = true;
  let again: ReturnType<typeof setTimeout> | undefined;
  const cycles: Cycle[] = ["layer", "release"];

  const round = () => {
    invoke<UpdateChoice[]>("update_choices", { cycles })
      .then((choices) => {
        if (!alive) return;
        const versions: Record<Cycle, string[]> = { ...state.versions, front: [] };
        for (const cycle of cycles) {
          const releases = choices
            .filter((choice) => choice.cycle === cycle)
            .map((choice) => choice.version);
          if (releases.length > 0) versions[cycle] = releases;
        }
        settle({ choices, versions });
      })
      .catch(() => undefined)
      .finally(() => {
        if (alive) again = setTimeout(round, EVERY);
      });
  };

  void askStanding().then((rungs) => {
    if (alive && rungs.some((rung) => rung.can)) round();
  });

  return () => {
    alive = false;
    clearTimeout(again);
  };
}

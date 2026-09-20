// Held for the window: the settings page unmounts mid-download. Which release each row
// points at is the backend's (src-tauri/src/update/kept.rs), since pages are replaced live.
import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";
import { notifications } from "../notifications";
import type { Layer, Press, Rung, UpdateChoice, UpdateState } from "./model";
import { wanted } from "./reading";

const RESTING: Press = { stage: "rest", progress: null, version: null };

export let state: UpdateState = {
  rungs: null,
  versions: [],
  choices: [],
  presses: { persistent: RESTING, ephemeral: RESTING },
};

const changes = notifications();

export function settle(change: Partial<UpdateState>): void {
  state = { ...state, ...change };
  changes.notify();
}

export function settlePress(layer: Layer, change: Partial<Press>): void {
  settle({ presses: { ...state.presses, [layer]: { ...state.presses[layer], ...change } } });
}

const read = () => state;

export function useUpdate(): UpdateState {
  return useSyncExternalStore(changes.subscribe, read, read);
}

export function rungOf(at: UpdateState, layer: Layer): Rung | null {
  return at.rungs?.find((rung) => rung.layer === layer) ?? null;
}

// A press before the list arrived was for the newest; it keeps reading as that release when the list lands.
export function stageOf(at: UpdateState, layer: Layer): Press["stage"] {
  const press = at.presses[layer];
  const rung = rungOf(at, layer);
  const same = press.version === null ? !rung?.picked : press.version === wanted(at, layer);
  return same ? press.stage : "rest";
}

/** Points the row at a version by name, or at whatever is newest. */
export async function declare(version: string | null): Promise<void> {
  try {
    await invoke("update_pick", { version });
  } catch {}
  // A preference the window re-asks anyway.
  await askStanding(true);
}

let asking: Promise<Rung[]> | null = null;

export function askStanding(again = false): Promise<Rung[]> {
  if (again) asking = null;
  asking ??= invoke<Rung[]>("update_standing").then(
    (rungs) => {
      settle({ rungs });
      return rungs;
    },

    () => {
      // No answer means no update rows, as an old copy shows.
      settle({ rungs: [] });
      return [];
    },
  );
  return asking;
}

const EVERY = 30 * 60_000;
// A window that is clicked back into every few seconds is not one that asks every few seconds.
const SETTLED = 5 * 60_000;

let choosing: Promise<void> | null = null;
let chosen = 0;

/**
 * Asks which releases there are. Nothing is asked where nothing could be taken, and a
 * failed ask keeps the list it had. `within` leaves an answer that recent alone.
 */
export function askChoices(within = 0): Promise<void> {
  if (choosing) return choosing;
  if (within > 0 && Date.now() - chosen < within) return Promise.resolve();
  choosing = askStanding()
    .then(async (rungs) => {
      if (!rungs.some((rung) => rung.can)) return;
      const choices = await invoke<UpdateChoice[]>("update_choices");
      chosen = Date.now();
      const versions = choices.map((choice) => choice.version);
      settle({ choices, versions: versions.length > 0 ? versions : state.versions });
    })
    .catch(() => undefined)
    .finally(() => {
      choosing = null;
    });
  return choosing;
}

// Polled from window open so the pull-down is full when opened, and asked again when the
// window is come back to: a release is usually looked for by the person who just made it.
export function watchUpdateChoices(): () => void {
  let alive = true;
  let again: ReturnType<typeof setTimeout> | undefined;

  const round = () => {
    void askChoices().finally(() => {
      if (alive) again = setTimeout(round, EVERY);
    });
  };
  const back = () => void askChoices(SETTLED);

  round();
  window.addEventListener("focus", back);

  return () => {
    alive = false;
    clearTimeout(again);
    window.removeEventListener("focus", back);
  };
}

import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useSyncExternalStore } from "react";

/**
 * Where the app is in replacing itself.
 *
 * One walk, not a set of choices: nothing is known until it is asked, the ask
 * either finds a newer release or does not, and what it finds is taken
 * immediately rather than offered a second time. So there is no state for "one
 * is available" — pressing the mark is asking for it, and the answer to that is
 * either the newest already being here or a download that has started.
 *
 * `ready` is only ever reached on macOS and Linux. The Windows installers are
 * run over the top of a closed app, so installing there ends this process and
 * the installer opens the new one: the window goes away and comes back, and
 * nothing is left waiting for a press.
 */
export type UpdateStage = "unknown" | "checking" | "current" | "fetching" | "ready" | "failed";

export type UpdateState = {
  /** Whether this copy is one the updater can replace; null until asked. */
  supported: boolean | null;
  stage: UpdateStage;
  /** How much of the download has arrived, 0..1, or null while it is untold. */
  progress: number | null;
};

/**
 * Held for the window rather than for the dialog.
 *
 * The settings dialog unmounts when it closes, and an update that has been
 * downloaded is waiting for a restart that may be minutes away — closing the
 * dialog in between must not forget that, or the next press downloads the same
 * release again. It is the same store `onDemand` keeps its parts in, for the
 * same reason.
 */
let state: UpdateState = { supported: null, stage: "unknown", progress: null };
const waiting = new Set<() => void>();

function settle(change: Partial<UpdateState>): void {
  state = { ...state, ...change };
  for (const wake of waiting) wake();
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

/**
 * Asks the backend whether this copy is one that can be replaced at all.
 *
 * Asked once for the life of the window: it is a fact about how the app was
 * installed, which does not change while it is running. A copy that says no
 * draws no mark — see `update.rs` for which those are.
 */
export function askSupported(): void {
  if (state.supported !== null) return;
  invoke<boolean>("self_update_supported").then(
    (yes) => settle({ supported: yes }),
    // A backend that will not answer is a window with no update mark, which is
    // the same thing an old copy of the app shows.
    () => settle({ supported: false }),
  );
}

/** How long the endpoint is given to answer, in milliseconds. */
const CHECK_TIMEOUT = 20_000;

/**
 * The whole of what the mark does, up to the restart.
 *
 * Looking and taking are one press because they are one intention: a window
 * that has just been told a newer version exists has nothing else to do with
 * that. What is not one press is the restart — this app holds terminals with
 * agents running in them, and ending those is nobody's business but the
 * person's who started them.
 */
export async function takeUpdate(): Promise<void> {
  if (state.stage === "checking" || state.stage === "fetching") return;
  settle({ stage: "checking", progress: null });

  let update: Update | null = null;
  try {
    // Bounded, so that an endpoint that accepts the connection and then says
    // nothing leaves a mark that has stopped rather than one still turning.
    update = await check({ timeout: CHECK_TIMEOUT });
    if (!update) {
      settle({ stage: "current", progress: null });
      return;
    }

    let length = 0;
    let taken = 0;
    settle({ stage: "fetching", progress: null });
    await update.downloadAndInstall((event) => {
      switch (event.event) {
        case "Started":
          length = event.data.contentLength ?? 0;
          taken = 0;
          break;
        case "Progress":
          taken += event.data.chunkLength;
          // A server that did not say how long the file is leaves the ring
          // turning instead of filling, which is the honest drawing of it.
          if (length > 0) settle({ progress: Math.min(1, taken / length) });
          break;
        case "Finished":
          settle({ progress: 1 });
          break;
      }
    });
    settle({ stage: "ready", progress: null });
  } catch {
    // Nothing is said about which of the several things went wrong — no
    // release, no network, a signature that did not verify. The mark goes red,
    // and pressing it again is what tries the whole of it again.
    settle({ stage: "failed", progress: null });
  } finally {
    // The handle is the backend's copy of the release metadata, and by here it
    // has either been installed or been given up on.
    await update?.close().catch(() => undefined);
  }
}

/**
 * Closes this copy and opens the one that has just replaced it.
 *
 * A restart that will not happen goes red like anything else that did not
 * finish: the new version is on disk either way, and starting the app again by
 * hand is the same ending.
 */
export function restart(): void {
  relaunch().catch(() => settle({ stage: "failed", progress: null }));
}

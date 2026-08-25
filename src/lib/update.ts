import { invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { useSyncExternalStore } from "react";

/**
 * Where the app is in replacing itself: one walk, not a set of choices.
 *
 * A release comes in two halves and they are not taken together — the first
 * press takes the pages and stops at `swapped`, the press after that goes on to
 * the program and stops at `ready`. `ready` is only reached on macOS and Linux;
 * `held` is where a `.deb` or an `.rpm` stops, because its program belongs to a
 * package manager. Which of the two a press ends in is the backend's to say.
 */
export type UpdateStage =
  | "unknown"
  | "checking"
  | "current"
  | "fetching"
  | "ready"
  | "swapped"
  | "held"
  | "failed";

export type UpdateState = {
  /** Whether this copy is one a release can do anything for; null until asked. */
  supported: boolean | null;
  stage: UpdateStage;
  /** How much of the download has arrived, 0..1, or null while it is untold. */
  progress: number | null;
};

/** Held for the window rather than for the dialog, which unmounts when it
 *  closes: an update waiting for a restart must survive that. */
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

/** Whether this copy is one a release page can do anything for. Asked once: it
 *  is a fact about how the app was installed. A copy that says no draws no mark. */
export function askSupported(): void {
  if (state.supported !== null) return;
  invoke<boolean>("update_supported").then(
    (yes) => settle({ supported: yes }),
    // A backend that will not answer is a window with no update mark, which is
    // the same thing an old copy of the app shows.
    () => settle({ supported: false }),
  );
}

/**
 * Says that this window has finished drawing itself, which is a taken front
 * being told it works: until it has said so once, the next start throws it away
 * rather than open on it. Called from every window on every start, because a
 * window cannot tell which front it is. See `src-tauri/src/front`.
 */
export function confirmFront(): void {
  invoke("confirm_front").catch(() => undefined);
}

/** What the backend did about the release it found. */
type Found = "front" | "whole" | "held" | "current";

/** How long the endpoint is given to answer, in milliseconds. */
const CHECK_TIMEOUT = 20_000;

/** How long the backend is given to say what it did about the release. Longer
 *  than the check: it is two reads of somebody else's server with a directory
 *  unpacked between them. What it stops is a press that is never answered. */
const TAKE_TIMEOUT = 90_000;

/** How long the whole of a release is given to arrive. Bounded apart from the
 *  check, because the handle `check` hands back would otherwise hold the
 *  download to the check's own twenty seconds. */
const FETCH_TIMEOUT = 15 * 60_000;

/** The same promise, given an end: a machine that never answers turns the ring
 *  red rather than leaving it spinning for as long as the window is open. */
function within<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const bell = setTimeout(() => reject(new Error("nothing answered in time")), ms);
    work.then(resolve, reject).finally(() => clearTimeout(bell));
  });
}

/**
 * The whole of what the mark does, up to the reload or the restart. Looking and
 * taking are one press because they are one intention; the ending is not,
 * because this app holds terminals with agents running in them.
 */
export async function takeUpdate(): Promise<void> {
  if (state.stage === "checking" || state.stage === "fetching") return;
  settle({ stage: "checking", progress: null });

  // The one ask that both halves are decided by. It reads the release page,
  // and if the pages of it are the part this copy can have, it has taken them
  // by the time it answers: a front is about a megabyte, which is nothing to
  // draw a second ring for.
  let found: Found;
  try {
    found = await within(invoke<Found>("take_front"), TAKE_TIMEOUT);
  } catch {
    settle({ stage: "failed", progress: null });
    return;
  }
  if (found !== "whole") {
    const reached = { front: "swapped", held: "held", current: "current" } as const;
    settle({ stage: reached[found], progress: null });
    return;
  }

  let update: Update | null = null;
  try {
    // Bounded, so that an endpoint that accepts the connection and then says
    // nothing leaves a mark that has stopped rather than one still turning.
    // This bounds the reading of the release page and nothing else: what is
    // downloaded off the back of it is held to `FETCH_TIMEOUT` where it is
    // asked for, because the two are not the same wait.
    update = await check({ timeout: CHECK_TIMEOUT });
    if (!update) {
      settle({ stage: "current", progress: null });
      return;
    }

    let length = 0;
    let taken = 0;
    settle({ stage: "fetching", progress: null });
    await update.downloadAndInstall(
      (event) => {
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
      },
      { timeout: FETCH_TIMEOUT },
    );
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

/** Draws the window again out of the front that has just arrived. Only the
 *  page: every terminal the program holds is still open, and what a view of one
 *  loses is redrawn from the backlog when it attaches again. */
export function reload(): void {
  window.location.reload();
}

/** Closes this copy and opens the one that replaced it. A restart that will not
 *  happen goes red: the new version is on disk either way. */
export function restart(): void {
  relaunch().catch(() => settle({ stage: "failed", progress: null }));
}

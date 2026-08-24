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
 * A release comes in two halves and they are not taken together. The pages the
 * window is drawn out of are a small download and a reload; the program under
 * them is a large one and a restart that ends every terminal in the window. So
 * the first press takes the pages and stops at `swapped`, and the press after
 * that — on a window already showing the new ones — goes on to the program and
 * stops at `ready`. Which of the two a press ends in is the backend's to say:
 * see `src-tauri/src/front/take.rs`.
 *
 * `ready` is only ever reached on macOS and Linux. The Windows installers are
 * run over the top of a closed app, so installing there ends this process and
 * the installer opens the new one: the window goes away and comes back, and
 * nothing is left waiting for a press.
 *
 * `held` is the end of the walk for a `.deb` or an `.rpm`: the pages are as new
 * as the release page has, and the program under them belongs to a package
 * manager, which is who brings it forward.
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
 * Asks the backend whether this copy is one a release page can do anything for.
 *
 * Asked once for the life of the window: it is a fact about how the app was
 * installed, which does not change while it is running. A copy that says no
 * draws no mark — see `update.rs` for which those are.
 */
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
 * Says that this window has finished drawing itself.
 *
 * Nothing is done with it unless the window was drawn out of a front taken from
 * a release, in which case this is the front being told it works: until it has
 * said so once, the next start of the app throws it away rather than open on
 * it. That is the whole of the way back out of a front that cannot draw a
 * window — see `src-tauri/src/front`, and note that this is called from every
 * window on every start, because a window cannot tell which front it is.
 */
export function confirmFront(): void {
  invoke("confirm_front").catch(() => undefined);
}

/** What the backend did about the release it found. */
type Found = "front" | "whole" | "held" | "current";

/** How long the endpoint is given to answer, in milliseconds. */
const CHECK_TIMEOUT = 20_000;

/**
 * How long the backend is given to say what it did about the release.
 *
 * Longer than the check, because it is two reads of somebody else's server and
 * a directory unpacked between them, and the backend already holds each of the
 * two to thirty seconds of its own — see `PATIENCE` in `front/take.rs`. So
 * nothing this bound stops is a slow release page; what it stops is a press
 * that is never answered at all, which is the one thing the mark cannot draw:
 * it turns while this is out, and it is not pressable while it turns.
 */
const TAKE_TIMEOUT = 90_000;

/**
 * How long the whole of a release is given to arrive, in milliseconds.
 *
 * Said here rather than left to the check, because the plugin would otherwise
 * say it once for both: the handle `check` hands back carries the timeout the
 * check was made with, and the download made from that handle is one request
 * held to it — twenty seconds for an installer of eighty megabytes, which is a
 * download that ends in red on every line anybody has. So the two are bounded
 * apart, each by what it actually is: a page of JSON that should come back
 * inside a breath, and a program that is worth waiting a while for.
 */
const FETCH_TIMEOUT = 15 * 60_000;

/**
 * The same promise, given an end.
 *
 * A mark that turns is a mark that is waiting on something, and everything it
 * waits on here is somebody else's machine. Where that machine answers late
 * the answer is still taken; where it never answers, this is what turns the
 * ring into a red mark that can be pressed again, instead of one that turns
 * for as long as the window is open.
 */
function within<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const bell = setTimeout(() => reject(new Error("nothing answered in time")), ms);
    work.then(resolve, reject).finally(() => clearTimeout(bell));
  });
}

/**
 * The whole of what the mark does, up to the reload or the restart.
 *
 * Looking and taking are one press because they are one intention: a window
 * that has just been told a newer version exists has nothing else to do with
 * that. What is not one press is the ending — this app holds terminals with
 * agents running in them, and reaching the point where they are interrupted is
 * nobody's business but the person's who started them.
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

/**
 * Draws the window again, out of the front that has just arrived.
 *
 * Only the page: the program is the same program, so every terminal it is
 * holding is still open and still being written to, and what a view of one
 * loses is redrawn from the backlog the moment it attaches again. That is what
 * makes this the cheap half of a release and worth having on its own.
 */
export function reload(): void {
  window.location.reload();
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

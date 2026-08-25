/**
 * What a press on one of the two rows does, up to the reload or the restart.
 */

import { Channel, invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import type { Half } from "./model";
import { settleHalf, state, wanted } from "./store";

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

/** What the backend did about the release the row was pointed at. */
type Took = "taken" | "current" | "held";

/**
 * How long a press on the pages row is given to be answered, in milliseconds.
 *
 * Longer than reading a release page, because it is two reads of somebody
 * else's server and a directory unpacked between them, and the backend already
 * holds each of the two to thirty seconds of its own — see `PATIENCE` in
 * `release.rs`. So nothing this bound stops is a slow release page; what it
 * stops is a press that is never answered at all, which is the one thing a row
 * cannot draw: the mark turns while this is out, and it is not pressable while
 * it turns.
 */
const FRONT_TIMEOUT = 90_000;

/**
 * The same for the program row, which is a download of eighty megabytes rather
 * than one of about a megabyte. It is the backend's own bound and a while over
 * — see `FETCHING` in `update.rs` — because this is only here to catch a press
 * nothing ever answers, and the thing it must not catch is a download somebody
 * on a slow line is still receiving.
 */
const WHOLE_TIMEOUT = 20 * 60_000;

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

/** Which ending each half's rows reach when the release is actually taken. */
const ENDING = { front: "swapped", whole: "ready" } as const;

/**
 * The whole of what one row does, up to the reload or the restart.
 *
 * The ending is not part of the press. This app holds terminals with agents
 * running in them, and reaching the point where they are interrupted is
 * nobody's business but the person's who started them — so a press brings the
 * release, and the press after it is what finishes.
 */
export async function take(half: Half): Promise<void> {
  if (state[half].stage === "taking") return;
  const version = wanted(state);
  settleHalf(half, { stage: "taking", progress: null, version });

  try {
    const took = half === "front" ? await takeFront(version) : await takeWhole(version);
    settleHalf(half, {
      stage: took === "taken" ? ENDING[half] : took,
      progress: null,
    });
  } catch {
    // Nothing is said about which of the several things went wrong — no
    // release under that tag, no network, a signature that did not verify. The
    // mark goes red, and pressing it again is what tries the whole of it again.
    settleHalf(half, { stage: "failed", progress: null });
  }
}

/** The pages: one ask, which has taken them by the time it answers. */
function takeFront(version: string | null): Promise<Took> {
  return within(invoke<Took>("take_front", { version }), FRONT_TIMEOUT);
}

/**
 * The program: one ask, with the download reporting itself as it arrives.
 *
 * The channel is the one thing a row cannot work out for itself. An installer
 * is large enough that a ring which only turns says nothing about whether
 * anything is happening, so the backend says how much has arrived and the ring
 * fills with it.
 */
function takeWhole(version: string | null): Promise<Took> {
  const coming = new Channel<{ taken: number; length: number | null }>();
  coming.onmessage = ({ taken, length }) => {
    // A server that did not say how long the file is leaves the ring turning
    // instead of filling, which is the honest drawing of it.
    if (length) settleHalf("whole", { progress: Math.min(1, taken / length) });
  };
  return within(invoke<Took>("take_whole", { version, coming }), WHOLE_TIMEOUT);
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
  relaunch().catch(() => settleHalf("whole", { stage: "failed", progress: null }));
}

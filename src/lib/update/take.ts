/**
 * What a press on one of the three rows does, up to whatever finishes it.
 */

import { Channel, invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import type { Layer } from "./model";
import { askStanding, settlePress, state, wanted } from "./store";

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
 * How long a press on one row is given to be answered, in milliseconds.
 *
 * Two numbers, because two of the rows are about a megabyte and the third is
 * about eighty. Neither is a bound on a slow release page — the backend already
 * holds every read of one to thirty seconds of its own, see `PATIENCE` in
 * `release.rs`. What they stop is a press that is never answered at all, which
 * is the one thing a row cannot draw: the mark turns while this is out, and it
 * is not pressable while it turns.
 */
const SMALL_TIMEOUT = 90_000;
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

/**
 * Which ending each row reaches when the release is actually taken.
 *
 * The application layer's is the one worth reading twice. It is `current`
 * because that is what it is: the layer was downloaded, started, and asked the
 * next question, so by the time the press is answered the new one is already
 * the one answering. Nothing is left to press, nothing is reloaded, and every
 * terminal in the window went on running throughout.
 */
const ENDING = { front: "swapped", app: "current", core: "ready" } as const;

/**
 * The whole of what one row does, up to whatever finishes it.
 *
 * The ending is not part of the press for two of the three. This app holds
 * terminals with agents running in them, and reaching the point where they are
 * interrupted is nobody's business but the person's who started them — so a
 * press brings the release, and the press after it is what finishes.
 */
export async function take(layer: Layer): Promise<void> {
  if (state.presses[layer].stage === "taking") return;
  const version = wanted(state, layer);
  settlePress(layer, { stage: "taking", progress: null, version });

  try {
    const took = await asked(layer, version);
    settlePress(layer, { stage: took === "taken" ? ENDING[layer] : took, progress: null });
  } catch {
    // Nothing is said about which of the several things went wrong — no
    // release under that tag, no network, a signature that did not verify. The
    // mark goes red, and pressing it again is what tries the whole of it again.
    settlePress(layer, { stage: "failed", progress: null });
  }
  // What is in place may have moved without anything else saying so, which is
  // the application layer's whole point.
  await askStanding(true);
}

/**
 * One ask, with the download reporting itself as it arrives.
 *
 * The channel is the one thing a row cannot work out for itself. A download is
 * large enough that a ring which only turns says nothing about whether anything
 * is happening, so the backend says how much has arrived and the ring fills
 * with it.
 */
function asked(layer: Layer, version: string | null): Promise<Took> {
  const coming = new Channel<{ taken: number; length: number | null }>();
  coming.onmessage = ({ taken, length }) => {
    // A server that did not say how long the file is leaves the ring turning
    // instead of filling, which is the honest drawing of it.
    if (length) settlePress(layer, { progress: Math.min(1, taken / length) });
  };
  return within(
    invoke<Took>("update_take", { layer, version, coming }),
    layer === "core" ? WHOLE_TIMEOUT : SMALL_TIMEOUT,
  );
}

/**
 * Draws the window again, out of the front that has just arrived.
 *
 * Only the page: the program is the same program, so every terminal it is
 * holding is still open and still being written to, and what a view of one
 * loses is redrawn from the backlog the moment it attaches again. That is what
 * makes this the cheap layer of a release and worth having on its own.
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
  relaunch().catch(() => settlePress("core", { stage: "failed", progress: null }));
}

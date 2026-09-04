/**
 * Adjusting one layer of the app to the version its row is pointed at.
 */

import { Channel, invoke } from "@tauri-apps/api/core";
import type { Layer, UpdateStage } from "./model";
import { askStanding, rungOf, settlePress, state, wanted } from "./store";

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
 * Two numbers, because the pages are about a megabyte and the program is
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
 * The ephemeral half's is `ready`: it is down and checked, and what puts it
 * in is this window leaving so that the next can open on it -- see `restart`.
 * Every terminal stays where it is throughout, because none of them are in
 * this window.
 *
 * The pages end in `swapped`: a reload, which is the cheap one. The
 * persistent half's row is never pressed, and answers `held` if it ever were.
 */
const ENDING = { front: "swapped", ephemeral: "ready", persistent: "held" } as const;

/**
 * Takes one physical layer to its declaration and returns the ending so the
 * settings can finish the reload the pages need during sync.
 */
export async function take(layer: Layer, target?: string | null): Promise<UpdateStage> {
  if (state.presses[layer].stage === "taking") return "taking";
  const version = target === undefined ? wanted(state, layer) : target;
  const declaration = rungOf(state, layer)?.picked ?? null;
  settlePress(layer, { stage: "taking", progress: null, version: declaration });

  try {
    const took = await asked(layer, version);
    const stage = took === "taken" ? ENDING[layer] : took;
    settlePress(layer, { stage, progress: null });
    await askStanding(true);
    return stage;
  } catch {
    // Nothing is said about which of the several things went wrong — no
    // release under that tag, no network, a signature that did not verify. The
    // mark goes red, and pressing it again is what tries the whole of it again.
    settlePress(layer, { stage: "failed", progress: null });
  }
  // What is in place may have moved before the press ran into whatever it ran
  // into, and the rows have to say what it is now.
  await askStanding(true);
  return "failed";
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
    layer === "ephemeral" ? WHOLE_TIMEOUT : SMALL_TIMEOUT,
  );
}

/**
 * Leaves, so that the release that came down can go in and the next window can
 * open on it.
 *
 * The backend hands the restart to the persistent half and then closes this
 * window; the terminals are that program's, and are still there when the next
 * window comes up. Nothing is expected back: a window that was
 * answered is a window that is already closing.
 */
export function restart(): void {
  invoke("update_restart").catch(() => undefined);
}

/**
 * Stops the program holding the terminals and starts one in its place, which
 * ends every terminal.
 *
 * `version` names one of the programs this machine holds, or null for the one
 * this window brought. The page says what this does before it is pressed; by
 * here it has been. What comes back is the row's stage: `current` when the
 * program is up again, and `failed` when it is not -- in which case what is
 * running is whatever the backend managed, and the rows are asked again to
 * say which.
 */
export async function restartPersistent(version: string | null): Promise<UpdateStage> {
  if (state.presses.persistent.stage === "taking") return "taking";
  settlePress("persistent", { stage: "taking", progress: null, version });
  try {
    await within(invoke("persistent_restart", { version }), SMALL_TIMEOUT);
    settlePress("persistent", { stage: "current", progress: null });
    await askStanding(true);
    return "current";
  } catch {
    settlePress("persistent", { stage: "failed", progress: null });
  }
  await askStanding(true);
  return "failed";
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

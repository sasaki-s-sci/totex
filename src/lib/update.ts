import { Channel, invoke } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { useSyncExternalStore } from "react";

/**
 * Where one half of the app is in being replaced.
 *
 * A release comes in two halves and they are not taken together. The pages the
 * window is drawn out of are a small download and a reload; the program under
 * them is a large one and a restart that ends every terminal in the window. So
 * there are two rows, each with its own walk from the offer to the ending, and
 * neither is done because the other was.
 *
 * `rest` is the offer to take whichever release the pull-down is on. What a
 * press ends in is the backend's to say: `swapped` for pages that are unpacked
 * and pointed at, `ready` for a program that is installed, `current` where that
 * release is what is already here, and `held` where this half cannot bring it —
 * pages the program has to bring, or a program a package manager owns.
 *
 * `ready` is only ever reached on macOS and Linux. The Windows installers are
 * run over the top of a closed app, so installing there ends this process and
 * the installer opens the new one: the window goes away and comes back, and
 * nothing is left waiting for a press.
 */
export type UpdateStage = "rest" | "taking" | "current" | "ready" | "swapped" | "held" | "failed";

/** Which half of a release a row is about. */
export type Half = "front" | "whole";

/** What this copy can be replaced with, and what it is at now. */
export type Standing = {
  /** Whether the pages can be replaced on their own. */
  front: boolean;
  /** Whether the program can replace itself. */
  whole: boolean;
  /** The version of the program running. */
  running: string;
  /** The version of the pages the window is drawn out of. */
  drawn: string;
};

/**
 * What the last press on one row did, and which release it did it about.
 *
 * The version is held with the stage because the two only mean anything
 * together: a row that says "reload to finish" is saying it about the release
 * it took, and moving the pull-down to another one leaves that offer standing
 * for a release nobody is looking at any more. So a row is read against what
 * the pull-down is on now — see [`stageOf`] — and a press for a different
 * version is the offer again rather than the ending of the last one.
 */
type Press = {
  stage: UpdateStage;
  /** How much of the download has arrived, 0..1, or null while it is untold. */
  progress: number | null;
  /** The version it is about, or null where none was named. */
  version: string | null;
};

export type UpdateState = {
  /** What can be replaced here; null until the backend has been asked. */
  standing: Standing | null;
  /** The releases there are, newest first, as the last poll found them. */
  versions: string[];
  /** The one taken off the list by hand, if any. */
  picked: string | null;
  front: Press;
  whole: Press;
};

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
let state: UpdateState = {
  standing: null,
  versions: [],
  picked: null,
  front: RESTING,
  whole: RESTING,
};

const waiting = new Set<() => void>();

function settle(change: Partial<UpdateState>): void {
  state = { ...state, ...change };
  for (const wake of waiting) wake();
}

/**
 * The same, for one of the two rows.
 *
 * Written out rather than keyed by the name, because a key that is a name held
 * in a variable is a key the type of the store cannot be checked against.
 */
function settleHalf(half: Half, change: Partial<Press>): void {
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

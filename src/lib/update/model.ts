/**
 * What a release is to this window: which halves can be replaced, what the last
 * press on each did, and which release it did it about.
 */

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
export type Press = {
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

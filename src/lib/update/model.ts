/**
 * What a release is to this window: the two halves of the app, and where each
 * of them stands in being replaced.
 */

/**
 * Where one layer of the app is in being replaced.
 *
 * `rest` is a row with no adjustment in flight. What an adjustment ends in is
 * the backend's to say: `swapped` for pages that are unpacked and pointed at,
 * `ready` for a program that is down, `current` where that release is what is
 * already here, and `held` where this layer cannot bring it.
 *
 * `ready` is the one that ends this window. A program cannot be put in
 * underneath a window that is open, so what a press does is bring it down; what
 * puts it in is this window leaving so that the next can open on it, which the
 * settings ask for the moment the download is here. The terminals are not in
 * this window -- they are the persistent half's -- so every one of them is
 * still there when the next window comes up. See `src-tauri/src/update/ready.rs`.
 */
export type UpdateStage = "rest" | "taking" | "current" | "ready" | "swapped" | "held" | "failed";

/**
 * Which layer of the app a row is about.
 *
 * `persistent` is the program beside the window that holds the terminals. It
 * is never adjusted from here: it comes with a release of the program, and
 * which releases replace it is said by the version number -- see `lineOf`. Its
 * row says what is running.
 *
 * `ephemeral` is this program and the pages inside it, which is what a release
 * replaces. `front` is the pages on their own: the part of the ephemeral half
 * a copy can take without an installer, which is the whole of the update a
 * copy the package manager owns can have.
 */
export type Layer = "persistent" | "ephemeral" | "front";

/** One layer, as the backend has it. */
export type Rung = {
  layer: Layer;
  /** The version in place now — being drawn, answering, or running. */
  at: string;
  /** Whether this copy can replace this layer at all. */
  can: boolean;
  /** The version it is pointed at, where one was named. */
  picked: string | null;
  /** The newest front contract this program answers, on the ephemeral row. */
  frontContract: number | null;
};

/** One release, and the agreement its pages were built to. */
export type UpdateChoice = {
  version: string;
  frontContract: number | null;
};

/**
 * The line a version is on: `major.minor`, which is the part of the number
 * that says whether the persistent half is the same program.
 *
 * A patch release replaces the ephemeral half alone, and the program holding
 * the terminals goes on holding them. A release on another line replaces that
 * program too, and there is no doing that without closing every terminal it
 * holds -- which is what the settings page says beside a version on another
 * line, before anybody presses.
 */
export function lineOf(version: string): string | null {
  const found = /^(\d+)\.(\d+)\.\d+$/.exec(version);
  return found ? `${found[1]}.${found[2]}` : null;
}

/**
 * What the last press on one row did, and which release it did it about.
 *
 * The version is held with the stage because the two only mean anything
 * together: a row that says "reload to finish" is saying it about the release
 * it took, and moving the row to another one leaves that offer standing for a
 * release nobody is looking at any more. So a row is read against what it is
 * pointed at now — see `stageOf` — and a press for a different version is the
 * offer again rather than the ending of the last one.
 */
export type Press = {
  stage: UpdateStage;
  /** How much of the download has arrived, 0..1, or null while it is untold. */
  progress: number | null;
  /** The version it is about, or null where none was named. */
  version: string | null;
};

export type UpdateState = {
  /** The layers as the backend last said them. */
  rungs: Rung[] | null;
  /** The releases there are, newest first, as the last poll found them. */
  versions: string[];
  /** The releases whose manifests were read, with what their pages need. */
  choices: UpdateChoice[];
  /** What the last press on each layer did. */
  presses: Record<Layer, Press>;
};

/**
 * What a release is to this window: its physical layers, compatibility, and
 * the last sync made to each.
 */

/**
 * Where one layer of the app is in being replaced.
 *
 * The backend replaces two physical layers: the pages, and the program. The
 * settings expose the two together as ephemeral, because a release moves both.
 *
 * `rest` is a declaration with no adjustment in flight. What an adjustment
 * ends in is the backend's to say: `swapped` for pages that are unpacked
 * and pointed at, `ready` for a program that is down, `current` where that
 * release is what is already here, and `held` where this layer cannot bring
 * it.
 *
 * `ready` is the one that ends this window. A program cannot be put in
 * underneath a window that is open, so what a press does is bring it down; what
 * puts it in is this window leaving so that the next can open on it, which the
 * settings ask for the moment the download is here. The terminals are not in
 * this window -- they are the keep's -- so every one of them is still there
 * when the next window comes up. See `src-tauri/src/update/ready.rs`.
 */
export type UpdateStage = "rest" | "taking" | "current" | "ready" | "swapped" | "held" | "failed";

/** Which physical layer of the app an adjustment is about. */
export type Layer = "front" | "core";

/**
 * Which cycle of releases a row is looking at.
 *
 * `release` is the app's own — one release, and both layers in it. `front` is
 * for pages that move between releases of the app, which is what makes the
 * two of them independent for real rather than only in how they are taken.
 */
export type Cycle = "release" | "front";

/** One physical layer, as the backend has it. */
export type Rung = {
  layer: Layer;
  /** The version in place now — being drawn, answering, or running. */
  at: string;
  /** Whether this copy can replace this layer at all. */
  can: boolean;
  /** Which cycle this row's releases are cut on. */
  cycle: Cycle;
  /** The version it is pointed at, where one was named. */
  picked: string | null;
  /** The newest front contract this program answers, on the program row. */
  frontContract: number | null;
};

/** One release and the compatibility agreement written into its manifest. */
export type UpdateChoice = {
  cycle: Cycle;
  version: string;
  frontContract: number | null;
};

/**
 * What the last press on one row did, and which release it did it about.
 *
 * The version is held with the stage because the two only mean anything
 * together: a row that says "reload to finish" is saying it about the release
 * it took, and moving the row to another one leaves that offer standing for a
 * release nobody is looking at any more. So a row is read against what it is
 * pointed at now — see [`stageOf`] — and a press for a different version is the
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
  /** The physical layers as the backend last said them. */
  rungs: Rung[] | null;
  /** The releases each cycle has, newest first, as the last poll found them. */
  versions: Record<Cycle, string[]>;
  /** The releases whose manifests were read, with their compatibility terms. */
  choices: UpdateChoice[];
  /** What the last sync of each physical layer did. */
  presses: Record<Layer, Press>;
};

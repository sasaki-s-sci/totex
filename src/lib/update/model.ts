/**
 * What a release is to this window: which layers can be replaced, what the last
 * press on each did, and which release it did it about.
 */

/**
 * Where one layer of the app is in being replaced.
 *
 * The app is three layers and they are not taken together, because they cost
 * different things. The pages the window is drawn out of are a small download
 * and a reload; the application layer beside the program is a small download
 * and nothing at all; the program itself is a large one and a restart that ends
 * every terminal in the window. So there are three rows, each with its own walk
 * from the offer to the ending, and none of them is done because another was.
 *
 * `rest` is the offer to take whichever release the row is pointed at. What a
 * press ends in is the backend's to say: `swapped` for pages that are unpacked
 * and pointed at, `ready` for a program that is installed, `current` where that
 * release is what is already here — which is also where the application layer
 * lands, because a layer that has been taken is already answering — and `held`
 * where this layer cannot bring it.
 *
 * `ready` is only ever reached on macOS and Linux. The Windows installers are
 * run over the top of a closed app, so installing there ends this process and
 * the installer opens the new one: the window goes away and comes back, and
 * nothing is left waiting for a press.
 */
export type UpdateStage = "rest" | "taking" | "current" | "ready" | "swapped" | "held" | "failed";

/** Which layer of the app a row is about. */
export type Layer = "front" | "app" | "core";

/** The three of them, in the order the rows are drawn: cheapest first. */
export const LAYERS: Layer[] = ["front", "app", "core"];

/**
 * Which cycle of releases a row is looking at.
 *
 * `release` is the app's own — one release, and all three layers in it. The
 * other two are for a layer that moves between releases of the app, which is
 * what makes the three of them independent for real rather than only in how
 * they are taken.
 */
export type Cycle = "release" | "layer" | "front";

/**
 * Which cycles each layer may follow.
 *
 * The program is on the app's own and nowhere else: what replaces it is an
 * installer, and installers are what a release of the app is. The other two are
 * a directory and a small program, which a release of their own can carry.
 */
export const CYCLES: Record<Layer, Cycle[]> = {
  front: ["release", "front"],
  app: ["release", "layer"],
  core: ["release"],
};

/** One row, as the backend has it: what is in place, and what it is pointed at. */
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
  /** The three rows as the backend last said them; null until it was asked. */
  rungs: Rung[] | null;
  /** The releases each cycle has, newest first, as the last poll found them. */
  versions: Record<Cycle, string[]>;
  /** What the last press on each row did. */
  presses: Record<Layer, Press>;
};

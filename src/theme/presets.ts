/**
 * The presets the window ships with.
 *
 * They are ordinary `Preset` values and nothing more — the same shape a preset
 * written by hand has, going through the same `themeFrom` as any other. There
 * is no built-in path and no private one: whatever is true of these is true of
 * anybody's, which is the only way to find out that a preset written elsewhere
 * actually works.
 */

import type { Preset } from "./scheme";

/**
 * Lit, and the one the window opens in.
 *
 * Every colour that names something is at full saturation. That is what is
 * being spent here: a window whose accents are half-saturated has to reach for
 * lightness to be seen, and lightness on a white ground is the one thing it
 * cannot have. So the chroma is pushed to the edge of sRGB and the lightness is
 * set to whatever leaves the colour readable on the surface it is set on —
 * around 3:1, which is what a colour standing in for a word has to clear.
 *
 * Dark is where this actually pays. On near-black there is no ceiling: mint,
 * orange and rose sit six to thirteen times the ground and read as lit rather
 * than as coloured, which is the whole reason to have a dark window at all.
 *
 * The same three words hold in both halves — green, orange, red — because the
 * rest of the window says them out loud. A preset whose light half called one
 * of them amber would leave every comment about a rim half true.
 */
export const NEON: Preset = {
  id: "neon",
  name: "Neon",
  light: {
    // Not white. The column and the cards are white, and a canvas of the same
    // white would leave them floating with nothing under them.
    ground: "#eef1f7",
    surface: "#ffffff",
    edge: "#d5dcea",
    ink: "#111826",
    inkMuted: "#5a6885",
    accent: "#1f8bff",
    accentAlt: "#a92bff",
    // Green, orange, red — arrived, rewritten, gone. Orange rather than the
    // amber this used to be: amber dark enough to read on white is a brown, and
    // brown is the one thing on the canvas that cannot be told from ink.
    added: "#00a961",
    changed: "#ef7000",
    removed: "#ff2d55",
  },
  dark: {
    // Near-black with the blue left in it, rather than the navy this used to
    // be. Navy is a colour, and a ground that is a colour is a ground every
    // accent has to argue with; the further down it goes the more the accents
    // are simply lights on it.
    ground: "#070a11",
    surface: "#141a28",
    edge: "#242e44",
    ink: "#e8edf7",
    inkMuted: "#8d9bb5",
    accent: "#43a5ff",
    accentAlt: "#c47dff",
    added: "#2ff59b",
    changed: "#ff9d3d",
    removed: "#ff5c78",
  },
};

/**
 * What the window was drawn in before the colours were lit.
 *
 * Kept, rather than dropped: the accents here are moderate on purpose, and a
 * window left open all day is a fair reason to want them back. It is also the
 * second preset the mechanism has, which is the only way a list of one proves
 * anything.
 */
export const CLASSIC: Preset = {
  id: "classic",
  name: "Classic",
  light: {
    ground: "#eef1f7",
    surface: "#ffffff",
    edge: "#d5dced",
    ink: "#161d2b",
    inkMuted: "#5d6b87",
    accent: "#2f6fe4",
    accentAlt: "#8d3fd1",
    added: "#0f9d63",
    changed: "#b57808",
    removed: "#d13a3a",
  },
  dark: {
    ground: "#0f1420",
    surface: "#151b2b",
    edge: "#273149",
    ink: "#e6ebf5",
    inkMuted: "#92a0bd",
    accent: "#4f8cff",
    accentAlt: "#b06cf0",
    added: "#22c07d",
    changed: "#f2b544",
    removed: "#ff6b6b",
  },
};

/** In the order they would be offered, with the one a window opens in first. */
export const PRESETS: readonly Preset[] = [NEON, CLASSIC];

/**
 * What a window that has never been told is drawn in.
 *
 * index.html paints these two grounds before any of this has been parsed — see
 * the note in its `<style>` — so moving the default here means moving them
 * there as well.
 */
export const DEFAULT_PRESET = NEON;

/** The preset that ships under this name, if one does. */
export function presetById(id: string): Preset | undefined {
  return PRESETS.find((preset) => preset.id === id);
}

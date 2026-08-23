/**
 * What a set of colours is, before it is a theme.
 *
 * Ten names and a colour apiece — no MUI, no CSS, nothing that has to be built.
 * That is the whole point of the file: a scheme is data, so it survives being
 * written down. It can be typed into a JSON file, passed between two people, or
 * read back out of the window's own storage, and none of those has to know what
 * a palette is.
 *
 * The names are the window's own rather than MUI's. Somebody choosing colours
 * is thinking about the ground the window stands on and the three things a file
 * can have become — not about `success` and `warning`, which are a form's words
 * for a dialog's traffic lights. The one place the two vocabularies meet is
 * `themeFrom`, next door in `index.ts`, and it is a table of ten lines.
 */
export interface Scheme {
  /** The canvas, and everything the window is laid out on. */
  ground: string;
  /** What stands on the ground: the folder column, cards, dialogs. */
  surface: string;
  /** Where one of those ends and the next begins. */
  edge: string;
  /** Names, commits, branch heads — everything the eye is meant to land on. */
  ink: string;
  /** The wiring: the lines between marks, second lines, what is only there. */
  inkMuted: string;
  /** What the window has hold of — a selection, a caret, the aim of a merge. */
  accent: string;
  /** The second of those, for the rare thing the first is already spoken for. */
  accentAlt: string;
  /** A file that has arrived. */
  added: string;
  /** A file that has been rewritten. */
  changed: string;
  /** A file that has gone. */
  removed: string;
}

/**
 * Every name a scheme has to answer for, in one place.
 *
 * `satisfies` is what keeps this honest: adding a colour to `Scheme` without
 * adding it here is a type error, and a scheme read off disk is only accepted
 * once every one of these has been found in it.
 */
export const SCHEME_KEYS = [
  "ground",
  "surface",
  "edge",
  "ink",
  "inkMuted",
  "accent",
  "accentAlt",
  "added",
  "changed",
  "removed",
] as const satisfies readonly (keyof Scheme)[];

/**
 * The two schemes a window can be drawn in, under one name.
 *
 * Both halves are required rather than one being derived from the other. A dark
 * scheme is not a light one turned over: what reads as a bright green on white
 * is a muddy one on near-black, and the neon that carries a dark window is a
 * stain on a light one. Whoever writes a preset writes both, and gets to decide
 * what each of them means.
 */
export interface Preset {
  /** What the preset is stored and looked up under. */
  id: string;
  /** What it is called, where there is room to say so. */
  name: string;
  light: Scheme;
  dark: Scheme;
}

/** `#rgb`, `#rrggbb`, `#rrggbbaa`. What CSS takes, and nothing that needs a parse. */
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/**
 * Reads a preset out of whatever was handed over, or says it could not.
 *
 * Handed over means: parsed out of storage, pasted into a field, read from a
 * file somebody wrote by hand. So none of it is trusted — a scheme missing one
 * name would leave that part of the window drawn in MUI's own default blue,
 * which is a stranger's colour in a window that was told to use somebody's, and
 * a colour that is not a colour would take the whole palette down with it.
 *
 * Nothing is filled in from the default: half a preset is not a preset, and a
 * window quietly running on a mix of two of them is worse than one that says it
 * did not understand and stays where it was.
 */
export function readPreset(value: unknown): Preset | null {
  const source = asRecord(value);
  if (!source) return null;

  const { id, name } = source;
  if (typeof id !== "string" || id === "") return null;

  const light = readScheme(source.light);
  const dark = readScheme(source.dark);
  if (!light || !dark) return null;

  return { id, name: typeof name === "string" && name !== "" ? name : id, light, dark };
}

function readScheme(value: unknown): Scheme | null {
  const source = asRecord(value);
  if (!source) return null;

  const scheme = {} as Scheme;
  for (const key of SCHEME_KEYS) {
    const colour = source[key];
    if (typeof colour !== "string" || !HEX.test(colour)) return null;
    scheme[key] = colour;
  }
  return scheme;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : null;
}

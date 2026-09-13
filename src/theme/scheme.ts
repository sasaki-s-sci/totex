export interface Scheme {
  /** The canvas. */
  ground: string;

  /** What stands on it: column, cards, dialogs. */
  surface: string;

  /** Dividers. */
  edge: string;

  ink: string;

  /** Lines and second-order text. */
  inkMuted: string;

  accent: string;

  /** For the rare thing `accent` is already spoken for. */
  accentAlt: string;

  added: string;

  changed: string;

  removed: string;
}

// `satisfies` makes a colour added to `Scheme` but not here a type error.
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

// Both halves required: a dark scheme is not a light one inverted.
export interface Preset {
  id: string;

  name: string;
  light: Scheme;
  dark: Scheme;
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

// Nothing is filled in from the default: half a preset is refused whole.
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

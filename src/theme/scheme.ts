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

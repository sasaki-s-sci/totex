// The JSON a theme is declared in. Built-ins and files under ~/.totex/themes go through the
// same reader, so a shipped theme is also the example of a user one.
//
// Three independent layers, each chosen on its own:
//   colors  — what everything is painted in, per light/dark half
//   style   — the shape of components: corners and type
//   effects — what is laid over or under the painted page
import { SCHEME_KEYS, type Scheme } from "./scheme.ts";

export type LayerKind = "colors" | "style" | "effects";
export const LAYER_KINDS = ["colors", "style", "effects"] as const satisfies readonly LayerKind[];

/** xterm's own names, so the object passes straight into `ITheme`. */
export const ANSI_KEYS = [
  "black",
  "red",
  "green",
  "yellow",
  "blue",
  "magenta",
  "cyan",
  "white",
  "brightBlack",
  "brightRed",
  "brightGreen",
  "brightYellow",
  "brightBlue",
  "brightMagenta",
  "brightCyan",
  "brightWhite",
] as const;
export type Ansi = Record<(typeof ANSI_KEYS)[number], string>;

export interface ColorsScheme extends Scheme {
  /** Absent: xterm's defaults. Present: all sixteen. */
  terminal?: Ansi;
}

export interface ColorsDeclaration {
  kind: "colors";
  id: string;
  name: string;
  light: ColorsScheme;
  dark: ColorsScheme;
}

export interface StyleDeclaration {
  kind: "style";
  id: string;
  name: string;
  /** Corner radius in px. */
  radius: number;
  font: {
    ui: string;
    mono: string;
    /** UI type size in px. */
    size: number;
  };
}

export type Material = "none" | "mica" | "acrylic" | "blur";

export interface EffectsDeclaration {
  kind: "effects";
  id: string;
  name: string;
  window: {
    /** The OS backdrop behind a see-through window; only Windows draws it. */
    material: Material;
    /** 0–1, how much of the ground and surfaces is painted over the backdrop. */
    opacity: number;
  };
  /** px of backdrop blur behind floating surfaces: menus, dialogs, popovers. 0 is none. */
  blur: number;
  /** An animated wave behind the canvas. Stills under reduced motion. */
  wave: {
    enabled: boolean;
    /** 0–1 of the accent's strength. */
    strength: number;
    /** Seconds per cycle. */
    period: number;
  };
  /** 0–1, CRT scanlines over terminals. */
  scanlines: number;
}

export type Declaration = ColorsDeclaration | StyleDeclaration | EffectsDeclaration;

export const DEFAULT_STYLE: StyleDeclaration = {
  kind: "style",
  id: "default",
  name: "Default",
  radius: 6,
  font: {
    ui: 'system-ui, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif',
    mono: 'ui-monospace, "Cascadia Mono", Consolas, monospace',
    size: 13,
  },
};

export const NO_EFFECTS: EffectsDeclaration = {
  kind: "effects",
  id: "none",
  name: "None",
  window: { material: "none", opacity: 1 },
  blur: 0,
  wave: { enabled: false, strength: 0.5, period: 12 },
  scanlines: 0,
};

export type Read = { ok: true; value: Declaration } | { ok: false; error: string };

// Colours are refused whole when anything is missing: a half-filled palette silently borrowing
// the default is worse than an error. Style and effects are overrides of a neutral base, so any
// field may be left out.
export function readDeclaration(value: unknown): Read {
  try {
    return { ok: true, value: declaration(value) };
  } catch (reason) {
    return { ok: false, error: reason instanceof Refusal ? reason.message : String(reason) };
  }
}

class Refusal extends Error {}
function refuse(message: string): never {
  throw new Refusal(message);
}

function declaration(value: unknown): Declaration {
  const source = record(value, "theme");
  const kind = source.kind;
  if (!LAYER_KINDS.includes(kind as LayerKind)) {
    refuse(`kind must be one of ${LAYER_KINDS.join(", ")}`);
  }
  const id = source.id;
  if (typeof id !== "string" || !/^[a-z0-9][a-z0-9._-]*$/i.test(id)) {
    refuse("id must be letters, digits, '.', '_' or '-'");
  }
  const name = typeof source.name === "string" && source.name !== "" ? source.name : id;

  switch (kind as LayerKind) {
    case "colors":
      return {
        kind: "colors",
        id,
        name,
        light: colorsScheme(source.light, "light"),
        dark: colorsScheme(source.dark, "dark"),
      };
    case "style":
      return style(source, id, name);
    case "effects":
      return effects(source, id, name);
  }
}

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

function colour(value: unknown, at: string): string {
  if (typeof value !== "string" || !HEX.test(value)) refuse(`${at} must be a #hex colour`);
  return value;
}

function colorsScheme(value: unknown, at: string): ColorsScheme {
  const source = record(value, at);
  const scheme = {} as ColorsScheme;
  for (const key of SCHEME_KEYS) scheme[key] = colour(source[key], `${at}.${key}`);
  if (source.terminal !== undefined) {
    const terminal = record(source.terminal, `${at}.terminal`);
    const ansi = {} as Ansi;
    for (const key of ANSI_KEYS) ansi[key] = colour(terminal[key], `${at}.terminal.${key}`);
    scheme.terminal = ansi;
  }
  return scheme;
}

function style(source: Record<string, unknown>, id: string, name: string): StyleDeclaration {
  const base = DEFAULT_STYLE;
  const font = optionalRecord(source.font, "font");
  return {
    kind: "style",
    id,
    name,
    radius: number(source.radius, "radius", 0, 24, base.radius),
    font: {
      ui: text(font.ui, "font.ui", base.font.ui),
      mono: text(font.mono, "font.mono", base.font.mono),
      size: number(font.size, "font.size", 10, 18, base.font.size),
    },
  };
}

const MATERIALS = ["none", "mica", "acrylic", "blur"] as const satisfies readonly Material[];

function effects(source: Record<string, unknown>, id: string, name: string): EffectsDeclaration {
  const base = NO_EFFECTS;
  const window = optionalRecord(source.window, "window");
  const wave = optionalRecord(source.wave, "wave");
  const material = window.material ?? base.window.material;
  if (!MATERIALS.includes(material as Material)) {
    refuse(`window.material must be one of ${MATERIALS.join(", ")}`);
  }
  return {
    kind: "effects",
    id,
    name,
    window: {
      material: material as Material,
      opacity: number(window.opacity, "window.opacity", 0, 1, base.window.opacity),
    },
    blur: number(source.blur, "blur", 0, 40, base.blur),
    wave: {
      enabled: flag(wave.enabled, "wave.enabled", Object.keys(wave).length > 0),
      strength: number(wave.strength, "wave.strength", 0, 1, base.wave.strength),
      period: number(wave.period, "wave.period", 2, 120, base.wave.period),
    },
    scanlines: number(source.scanlines, "scanlines", 0, 1, base.scanlines),
  };
}

function record(value: unknown, at: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    refuse(`${at} must be an object`);
  }
  return value as Record<string, unknown>;
}

function optionalRecord(value: unknown, at: string): Record<string, unknown> {
  return value === undefined ? {} : record(value, at);
}

function number(value: unknown, at: string, least: number, most: number, fallback: number) {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !(value >= least && value <= most)) {
    refuse(`${at} must be a number from ${least} to ${most}`);
  }
  return value;
}

function text(value: unknown, at: string, fallback: string): string {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || value === "") refuse(`${at} must be a non-empty string`);
  return value;
}

function flag(value: unknown, at: string, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") refuse(`${at} must be true or false`);
  return value;
}

import type { Preset } from "./scheme";

export const NEON: Preset = {
  id: "neon",
  name: "Neon",
  light: {
    // Not white: cards are white and need something under them.
    ground: "#eef1f7",
    surface: "#ffffff",
    edge: "#d5dcea",
    ink: "#111826",
    inkMuted: "#5a6885",
    accent: "#1f8bff",
    accentAlt: "#a92bff",

    // Orange, not amber: amber dark enough for white is brown, which cannot be told from ink.
    added: "#00a961",
    changed: "#ef7000",
    removed: "#ff2d55",
  },
  dark: {
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

export const PRESETS: readonly Preset[] = [NEON, CLASSIC];

// index.html paints these grounds before any script; change both together.
export const DEFAULT_PRESET = NEON;

export function presetById(id: string): Preset | undefined {
  return PRESETS.find((preset) => preset.id === id);
}

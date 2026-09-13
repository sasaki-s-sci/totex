import {
  createTheme,
  type Palette,
  type Theme,
  useColorScheme,
  useTheme,
} from "@mui/material/styles";

import { settingsNow } from "../lib/appSettings";
import { DEFAULT_PRESET, presetById } from "./presets";
import { type Preset, readPreset, type Scheme } from "./scheme";

export { CLASSIC, DEFAULT_PRESET, NEON, PRESETS, presetById } from "./presets";
export { type Preset, readPreset, SCHEME_KEYS, type Scheme } from "./scheme";

export type ThemeMode = "system" | "light" | "dark";

/** A mode with `system` resolved. */
export type Half = "light" | "dark";

export const PRESET_KEY = "totex.preset";

const SCHEME_ATTRIBUTE = "data-color-scheme";

// The only place the scheme's names meet MUI's.
function paletteFrom(scheme: Scheme) {
  return {
    primary: { main: scheme.accent },
    secondary: { main: scheme.accentAlt },
    success: { main: scheme.added },
    warning: { main: scheme.changed },
    error: { main: scheme.removed },
    divider: scheme.edge,
    background: { default: scheme.ground, paper: scheme.surface },
    text: { primary: scheme.ink, secondary: scheme.inkMuted },
  };
}

// `cssVariables` lets the graph's thousands of nodes read colours from a plain stylesheet.
// The attribute selector, not the media query, is what makes the mode switchable.
export function themeFrom(preset: Preset): Theme {
  return createTheme({
    cssVariables: { colorSchemeSelector: SCHEME_ATTRIBUTE },
    colorSchemes: {
      light: { palette: paletteFrom(preset.light) },
      dark: { palette: paletteFrom(preset.dark) },
    },
    shape: { borderRadius: 6 },
    typography: {
      fontFamily: 'system-ui, "Segoe UI", "Hiragino Sans", "Noto Sans JP", sans-serif',
      fontSize: 13,
      button: { textTransform: "none", fontWeight: 600 },
    },
    components: {
      MuiButtonBase: { defaultProps: { disableRipple: true } },
      MuiListItemButton: {
        styleOverrides: {
          root: { paddingTop: 1, paddingBottom: 1, borderRadius: 4 },
        },
      },
    },
  });
}

// A shipped id, or a whole preset written out.
export function storedPreset(): Preset {
  try {
    const stored = localStorage.getItem(PRESET_KEY);
    if (stored) return presetById(stored) ?? readPreset(JSON.parse(stored)) ?? DEFAULT_PRESET;
  } catch {}
  return DEFAULT_PRESET;
}

// Built once at load; changing preset is a restart.
export const theme = themeFrom(storedPreset());

// Read directly: the provider reads it in an effect, a frame after first paint.
export function storedMode(): ThemeMode {
  return settingsNow().theme;
}

// Before the first render; index.html's boot colours key on the same attribute.
export function applyStoredMode(): void {
  document.documentElement.setAttribute(SCHEME_ATTRIBUTE, schemeFor(storedMode()));
}

function schemeFor(mode: ThemeMode): Half {
  if (mode !== "system") return mode;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function documentScheme(): Half {
  return document.documentElement.getAttribute(SCHEME_ATTRIBUTE) === "dark" ? "dark" : "light";
}

// `useTheme().palette` holds the default half only; the switch happens in CSS. Read the
// resolved half, or a terminal built in a dark window comes out white.
export function usePalette(): Palette {
  const theme = useTheme();
  const { colorScheme } = useColorScheme();

  // Undefined for the frame before the provider has read storage; the document already has the answer.
  return theme.colorSchemes[colorScheme ?? documentScheme()]?.palette ?? theme.palette;
}

import {
  createTheme,
  type Palette,
  type Theme,
  useColorScheme,
  useTheme,
} from "@mui/material/styles";

import { settingsNow } from "../lib/appSettings";
import { useAppearance } from "./appearance";
import type { ColorsDeclaration, StyleDeclaration } from "./declaration";
import type { Scheme } from "./scheme";

export { appearanceNow, useAppearance } from "./appearance";
export type { ColorsDeclaration, EffectsDeclaration, StyleDeclaration } from "./declaration";
export { SCHEME_KEYS, type Scheme } from "./scheme";

export type ThemeMode = "system" | "light" | "dark";

/** A mode with `system` resolved. */
export type Half = "light" | "dark";

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
// Rebuilt whenever either layer changes; MUI rewrites its variables in place.
export function themeFrom(colors: ColorsDeclaration, style: StyleDeclaration): Theme {
  return createTheme({
    cssVariables: { colorSchemeSelector: SCHEME_ATTRIBUTE },
    colorSchemes: {
      light: { palette: paletteFrom(colors.light) },
      dark: { palette: paletteFrom(colors.dark) },
    },
    shape: { borderRadius: style.radius },
    typography: {
      fontFamily: style.font.ui,
      fontSize: style.font.size,
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

/** The half the window is drawn in now. */
export function useHalf(): Half {
  const { colorScheme } = useColorScheme();
  return colorScheme ?? documentScheme();
}

/** What a terminal takes from the layers beyond MUI's palette. */
export function useTerminalLook() {
  const { colors, style, effects } = useAppearance();
  const half = useHalf();
  return {
    ansi: colors[half].terminal,
    mono: style.font.mono,
    // xterm's webgl renderer paints an opaque ground unless told the page shows through.
    seeThrough: effects.window.opacity < 1,
    opacity: effects.window.opacity,
  };
}

/** `#rgb`/`#rrggbb` with an alpha channel; anything else is returned as it came. */
export function withAlpha(colour: string, alpha: number): string {
  const long = /^#[0-9a-f]{3}$/i.test(colour)
    ? `#${[...colour.slice(1)].map((digit) => digit + digit).join("")}`
    : colour;
  if (alpha >= 1 || !/^#[0-9a-f]{6}$/i.test(long)) return colour;
  const byte = Math.round(Math.max(0, alpha) * 255);
  return long + byte.toString(16).padStart(2, "0");
}

// `useTheme().palette` holds the default half only; the switch happens in CSS. Read the
// resolved half, or a terminal built in a dark window comes out white.
export function usePalette(): Palette {
  const theme = useTheme();
  const { colorScheme } = useColorScheme();

  // Undefined for the frame before the provider has read storage; the document already has the answer.
  return theme.colorSchemes[colorScheme ?? documentScheme()]?.palette ?? theme.palette;
}

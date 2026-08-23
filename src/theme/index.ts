import {
  createTheme,
  type Palette,
  type Theme,
  useColorScheme,
  useTheme,
} from "@mui/material/styles";

import { DEFAULT_PRESET, presetById } from "./presets";
import { type Preset, readPreset, type Scheme } from "./scheme";

export { CLASSIC, DEFAULT_PRESET, NEON, PRESETS, presetById } from "./presets";
export { type Preset, readPreset, SCHEME_KEYS, type Scheme } from "./scheme";

/** Which of the two the window is drawn in, or the machine's own answer. */
export type ThemeMode = "system" | "light" | "dark";

/**
 * Which of the two it came out as.
 *
 * `system` is a question rather than an answer, and everything downstream of it
 * — the attribute on the document, the half of the preset in use — needs the
 * answer. This is that: a mode with the question taken out of it.
 */
export type Half = "light" | "dark";

/** Where the choice is kept, and what the provider is told to keep it under. */
export const MODE_KEY = "totex.mode";

/** Where the colours are kept: a preset's name, or a whole preset. See `storedPreset`. */
export const PRESET_KEY = "totex.preset";

/** The attribute the chosen scheme is written to, on the document element. */
const SCHEME_ATTRIBUTE = "data-color-scheme";

/**
 * The one place a scheme's ten names become MUI's.
 *
 * MUI's palette is a form's vocabulary — `success` is the green a submitted
 * field turns — and this window is not a form. What is green here is a file
 * that has arrived, which is a fact about a repository rather than about
 * anything having gone well. So the window's own names are what a preset is
 * written in, and this table is the whole of the translation. Nothing else in
 * the app is allowed to know both halves.
 *
 * The rest of the palette is left to MUI. `text.disabled`, `action.hover` and
 * `action.selected` are the same faint wash of the ink in every theme, and a
 * preset that had to name them would be asking whoever writes it to have an
 * opinion about something they cannot see.
 */
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

/**
 * A theme, from a preset and nothing else.
 *
 * `cssVariables` publishes every palette entry as a custom property, which is
 * what lets the graph — thousands of nodes that cannot afford a styled wrapper
 * each — read the same colours from a plain stylesheet.
 *
 * The two sets are chosen by an attribute rather than by the media query, which
 * is what makes them switchable at all: a stylesheet keyed on
 * `prefers-color-scheme` answers to the machine and to nothing in the window.
 * The machine still decides by default — see `storedMode` — and this is only
 * where that answer is written down.
 *
 * Everything below the palette is the window's shape rather than its colour:
 * the same dense rows and the same corners whichever preset is on, because a
 * preset is a set of colours and not a second design.
 */
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
      // The window is a tool, not a document: rows are dense and nothing shouts.
      MuiButtonBase: { defaultProps: { disableRipple: true } },
      MuiListItemButton: {
        styleOverrides: {
          root: { paddingTop: 1, paddingBottom: 1, borderRadius: 4 },
        },
      },
    },
  });
}

/**
 * The colours the window was last set to, or the ones it ships with.
 *
 * One key holds either of two things, and which one it is says where the preset
 * came from. A name is one of the presets that ship here, and is stored as a
 * name so that it keeps up when those colours are revised. Anything else is
 * read as a preset written out whole — which is how somebody's own survives a
 * restart without the app having to keep a library of them.
 */
export function storedPreset(): Preset {
  try {
    const stored = localStorage.getItem(PRESET_KEY);
    if (stored) return presetById(stored) ?? readPreset(JSON.parse(stored)) ?? DEFAULT_PRESET;
  } catch {
    // A window that cannot remember the colours, or was left holding something
    // it cannot read, opens in the ones it ships with. There is nothing to
    // report: the colours are the whole of what was lost.
  }
  return DEFAULT_PRESET;
}

/**
 * The theme the window is running on.
 *
 * Built once, at load, from whatever was stored — the same moment `main` writes
 * the mode onto the document, and before anything has been drawn from either.
 * Changing preset is therefore a restart for now; the seam for doing it live is
 * `themeFrom`, which takes any preset and knows nothing about storage.
 */
export const theme = themeFrom(storedPreset());

/**
 * The mode the window was last set to, or the machine's own if it never was.
 *
 * Read directly rather than through the provider, because the provider reads it
 * in an effect — one frame after the first paint. A window that opens light and
 * turns dark a frame later is the flash this avoids.
 */
export function storedMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(MODE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // A window that cannot remember the choice still follows the machine.
  }
  return "system";
}

/**
 * Writes the mode onto the document, before React has drawn anything.
 *
 * Called from `main`, ahead of the first render: the palette is chosen by this
 * attribute, and index.html's boot colours are chosen by it too, so setting it
 * here is what keeps the ground the window opens on the ground it stays on.
 */
export function applyStoredMode(): void {
  document.documentElement.setAttribute(SCHEME_ATTRIBUTE, schemeFor(storedMode()));
}

/** Which of the two a mode comes out as, with the machine asked if it has to be. */
function schemeFor(mode: ThemeMode): Half {
  if (mode !== "system") return mode;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** Which of the two the document is carrying, which is what the window is painted in. */
function documentScheme(): Half {
  return document.documentElement.getAttribute(SCHEME_ATTRIBUTE) === "dark" ? "dark" : "light";
}

/**
 * The colours the window is being drawn in, as colours.
 *
 * `useTheme().palette` is not those. `cssVariables` publishes both halves as
 * custom properties and leaves the theme object holding whichever half is the
 * default — the switch happens in CSS, and nothing about the theme is rebuilt
 * for it. So everything drawn by MUI or by a stylesheet follows the mode, and
 * anything that has to hand a colour to something that is not CSS — a canvas, a
 * terminal — reads the light one all day and never hears about the dark.
 *
 * This is the way across: the scheme is resolved, and the palette read off that
 * half. Still MUI's palette, so the derived washes nobody names — `text.disabled`,
 * `action.selected` — come with it, and every value is a colour rather than a
 * `var()` that only a stylesheet could resolve.
 */
export function usePalette(): Palette {
  const theme = useTheme();
  const { colorScheme } = useColorScheme();
  // Undefined for the frame before the provider has read what was stored — a
  // frame that has already been painted in one of the two, because
  // `applyStoredMode` wrote the answer onto the document ahead of it. Which is
  // why that is what is read rather than the light half being assumed: the
  // terminal built in that frame would be built white in a dark window.
  return theme.colorSchemes[colorScheme ?? documentScheme()]?.palette ?? theme.palette;
}

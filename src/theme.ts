import { createTheme } from "@mui/material/styles";

/** Which of the two the window is drawn in, or the machine's own answer. */
export type ThemeMode = "system" | "light" | "dark";

/** Where the choice is kept, and what the provider is told to keep it under. */
export const MODE_KEY = "totex.mode";

/** The attribute the chosen scheme is written to, on the document element. */
const SCHEME_ATTRIBUTE = "data-color-scheme";

/**
 * The one place a colour is decided.
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
 */
export const theme = createTheme({
  cssVariables: { colorSchemeSelector: SCHEME_ATTRIBUTE },
  colorSchemes: {
    light: {
      palette: {
        primary: { main: "#2f6fe4" },
        secondary: { main: "#8d3fd1" },
        success: { main: "#0f9d63" },
        warning: { main: "#b57808" },
        error: { main: "#d13a3a" },
        divider: "#d5dced",
        background: { default: "#eef1f7", paper: "#ffffff" },
        text: { primary: "#161d2b", secondary: "#5d6b87" },
      },
    },
    dark: {
      palette: {
        primary: { main: "#4f8cff" },
        secondary: { main: "#b06cf0" },
        success: { main: "#22c07d" },
        warning: { main: "#f2b544" },
        error: { main: "#ff6b6b" },
        divider: "#273149",
        background: { default: "#0f1420", paper: "#151b2b" },
        text: { primary: "#e6ebf5", secondary: "#92a0bd" },
      },
    },
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
  const mode = storedMode();
  const scheme =
    mode === "system"
      ? matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light"
      : mode;
  document.documentElement.setAttribute(SCHEME_ATTRIBUTE, scheme);
}

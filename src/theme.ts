import { createTheme } from "@mui/material/styles";

/**
 * The one place a colour is decided.
 *
 * `cssVariables` publishes every palette entry as a custom property, which is
 * what lets the graph — thousands of nodes that cannot afford a styled wrapper
 * each — read the same colours from a plain stylesheet.
 */
export const theme = createTheme({
  cssVariables: { colorSchemeSelector: "media" },
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

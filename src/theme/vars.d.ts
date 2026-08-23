/**
 * That this window's theme is built with `cssVariables`, said in the types.
 *
 * `colorSchemes` and `vars` are only on a theme created that way, and the flag
 * that creates one is a value — so nothing in the type system knows it was set
 * unless it is told here. Told once, for the whole app: `themeFrom` is the only
 * place a theme is made, and every `useTheme` in the window is reading that one.
 */

declare module "@mui/material/styles" {
  interface CssThemeVariables {
    enabled: true;
  }
}

export {};

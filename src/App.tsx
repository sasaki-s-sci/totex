import { CssBaseline } from "@mui/material";
import { ThemeProvider, useColorScheme } from "@mui/material/styles";
import { useEffect, useMemo, useState } from "react";
import { useAppSettings } from "./lib/appSettings";
import { isCardWindow } from "./lib/thisWindow";
import { cardPart } from "./parts";
import { storedMode, themeFrom, useAppearance } from "./theme";
import { Effects } from "./theme/effects";
import { Window } from "./window/Window";
import "./theme/rail.css";

export default function App() {
  const [torn] = useState(isCardWindow);
  const { colors, style } = useAppearance();
  const theme = useMemo(() => themeFrom(colors, style), [colors, style]);
  return (
    // `main` already wrote the mode onto the document; the provider is told the same so the two
    // agree from the first render.
    <ThemeProvider
      theme={theme}
      defaultMode={storedMode()}
      storageManager={null}
      disableTransitionOnChange
    >
      <SettingsTheme />
      <MonoFace face={style.font.mono} />
      <CssBaseline />
      <Effects />
      {torn ? <TornCard /> : <Window />}
    </ThemeProvider>
  );
}

/** A window holding one card torn off the main one; see `lib/cardWindow`. */
function TornCard() {
  const CardWindow = cardPart.use();
  return CardWindow ? <CardWindow /> : null;
}

function SettingsTheme() {
  const { theme } = useAppSettings();
  const { setMode } = useColorScheme();
  useEffect(() => setMode(theme), [theme, setMode]);
  return null;
}

/** Stylesheets that set monospace text read the style layer's face from here. */
function MonoFace({ face }: { face: string }) {
  useEffect(() => {
    document.documentElement.style.setProperty("--totex-mono", face);
  }, [face]);
  return null;
}

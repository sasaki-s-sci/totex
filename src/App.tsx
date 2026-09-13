import { CssBaseline } from "@mui/material";
import { ThemeProvider, useColorScheme } from "@mui/material/styles";
import { useEffect, useState } from "react";
import { useAppSettings } from "./lib/appSettings";
import { isCardWindow } from "./lib/thisWindow";
import { cardPart } from "./parts";
import { storedMode, theme } from "./theme";
import { Window } from "./window/Window";

export default function App() {
  const [torn] = useState(isCardWindow);
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
      <CssBaseline />
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

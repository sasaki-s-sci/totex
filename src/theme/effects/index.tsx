// The effects layer: what is laid over or under the painted page. Everything here is a
// stylesheet, a native window call or one canvas, each taken back out when its declaration
// says so, so switching to "none" leaves the window as if no effect had ever been chosen.
import { useColorScheme } from "@mui/material/styles";
import { useState } from "react";

import { isCardWindow } from "../../lib/thisWindow";
import { useAppearance } from "../appearance";
import { blurSheet, GROUND_SHEET, opacitySheet, scanlineSheet } from "./css";
import { useMaterial } from "./material";
import { useStyleSheet } from "./sheet";
import { Wave } from "./Wave";

export function Effects() {
  // A torn card window is already see-through and paints only its card; the window-wide
  // effects belong to the main window.
  const [main] = useState(() => !isCardWindow());
  const { colors, effects } = useAppearance();
  const { colorScheme } = useColorScheme();
  const half = colorScheme ?? documentHalf();

  useStyleSheet("ground", main ? GROUND_SHEET : null);
  useStyleSheet("opacity", main ? opacitySheet(effects, colors) : null);
  useStyleSheet("blur", blurSheet(effects));
  useStyleSheet("scanlines", scanlineSheet(effects));
  useMaterial(effects.window.material, main);

  if (!main || !effects.wave.enabled || effects.wave.strength <= 0) return null;
  const scheme = colors[half];
  return (
    <Wave
      strength={effects.wave.strength}
      period={effects.wave.period}
      accent={scheme.accent}
      accentAlt={scheme.accentAlt}
    />
  );
}

// The provider's answer is undefined for its first frame; `main` has already written the half.
function documentHalf(): "light" | "dark" {
  return document.documentElement.getAttribute("data-color-scheme") === "dark" ? "dark" : "light";
}

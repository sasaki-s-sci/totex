/**
 * Which of the three the window is drawn in.
 */

import { ToggleButton, ToggleButtonGroup } from "@mui/material";
import { useColorScheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";

import type { ThemeMode } from "../../theme";
import { Row } from "./Row";

/**
 * The three the window can be drawn in, in the order they are offered.
 *
 * The machine's own is first because it is where a window that has never been
 * told starts, and going back to it is how that is given back.
 */
const THEMES: readonly ThemeMode[] = ["system", "light", "dark"];

/** What each of the three is called. */
const THEME_LABELS = {
  system: "theme.system",
  light: "theme.light",
  dark: "theme.dark",
} as const;

/**
 * Which of the three the window is drawn in.
 *
 * Three laid out rather than one pressed round them: this is a thing gone
 * looking for, and something looked for is answered by showing what there is to
 * pick, not by a button that has to be pressed twice to find out what the third
 * state was.
 */
export function ThemeRow() {
  const { t } = useTranslation();
  const { mode, setMode } = useColorScheme();
  // Undefined for the frame before the provider has read what was stored. The
  // document already carries the answer by then — `applyStoredMode` wrote it —
  // so this is only which of the three is lit, and the machine's own is what a
  // window that has never been told is set to.
  const current = mode ?? "system";

  return (
    <Row label={t("settings.theme")}>
      <ToggleButtonGroup
        exclusive
        size="small"
        aria-label={t("settings.theme")}
        value={current}
        onChange={(_, next: ThemeMode | null) => next && setMode(next)}
      >
        {THEMES.map((option) => (
          <ToggleButton key={option} value={option} sx={{ px: 1.25, py: 0.4 }}>
            {t(THEME_LABELS[option])}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Row>
  );
}

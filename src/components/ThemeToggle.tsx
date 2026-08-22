import { ToggleButton, ToggleButtonGroup } from "@mui/material";
import { useColorScheme } from "@mui/material/styles";
import { useTranslation } from "react-i18next";

import type { ThemeMode } from "../theme";
import { ThemeMark } from "./marks";

/**
 * The three the window can be drawn in, in the order they are offered.
 *
 * The machine's own is first because it is where a window that has never been
 * told starts, and going back to it is how that is given back.
 */
const ORDER: readonly ThemeMode[] = ["system", "light", "dark"];

/** What each of them is called, for something reading the window aloud. */
const LABELS = {
  system: "theme.system",
  light: "theme.light",
  dark: "theme.dark",
} as const;

/**
 * Which of the three the window is drawn in, as a row in the settings dialog.
 *
 * Three marks laid out rather than one pressed round them: this is a thing
 * gone looking for — the dialog has to be opened to reach it — and something
 * looked for is answered by showing what there is to pick, not by a mark that
 * has to be pressed twice to find out what the third state was. It is the same
 * row the surface choice above it is, for the same reason.
 *
 * The marks are the ones the window draws elsewhere — see `ThemeMark` — so the
 * one that is on is the one lit, and there is nothing else to read.
 */
export function ThemeToggle() {
  const { t } = useTranslation();
  const { mode, setMode } = useColorScheme();
  // Undefined for the frame before the provider has read what was stored. The
  // document already carries the answer by then — `applyStoredMode` wrote it —
  // so this is only which mark is lit, and the machine's own is what a window
  // that has never been told is set to.
  const current = mode ?? "system";

  return (
    <ToggleButtonGroup
      exclusive
      size="small"
      value={current}
      onChange={(_, next: ThemeMode | null) => next && setMode(next)}
    >
      {ORDER.map((option) => (
        <ToggleButton
          key={option}
          value={option}
          aria-label={t(LABELS[option])}
          sx={{ px: 1.5, py: 0.5 }}
        >
          <ThemeMark mode={option} />
        </ToggleButton>
      ))}
    </ToggleButtonGroup>
  );
}

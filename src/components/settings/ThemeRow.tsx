/**
 * Which of the three the window is drawn in.
 */

import { MenuItem, Select, type SelectChangeEvent } from "@mui/material";
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
 * The choices share a compact pull-down because only the current mode needs to
 * remain visible once it has been chosen.
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
      <Select
        size="small"
        value={current}
        onChange={(event: SelectChangeEvent<ThemeMode>) => setMode(event.target.value as ThemeMode)}
        inputProps={{ "aria-label": t("settings.theme") }}
        sx={{ minWidth: 132 }}
      >
        {THEMES.map((option) => (
          <MenuItem key={option} value={option}>
            {t(THEME_LABELS[option])}
          </MenuItem>
        ))}
      </Select>
    </Row>
  );
}

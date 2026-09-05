/**
 * Which of the three the window is drawn in.
 */

import { MenuItem, Select, type SelectChangeEvent } from "@mui/material";
import { useTranslation } from "react-i18next";

import { updateSettings, useAppSettings } from "../../lib/appSettings";
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
  const { theme: current } = useAppSettings();

  return (
    <Row label={t("settings.theme")}>
      <Select
        size="small"
        value={current}
        onChange={(event: SelectChangeEvent<ThemeMode>) =>
          updateSettings({ theme: event.target.value as ThemeMode })
        }
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

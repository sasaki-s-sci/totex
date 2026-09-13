import { MenuItem, Select, type SelectChangeEvent } from "@mui/material";
import { useTranslation } from "react-i18next";

import { updateSettings, useAppSettings } from "../lib/appSettings";
import type { ThemeMode } from "../theme";
import { PICK_SX, Row } from "./Row";

const THEMES: readonly ThemeMode[] = ["system", "light", "dark"];

const THEME_LABELS = {
  system: "theme.system",
  light: "theme.light",
  dark: "theme.dark",
} as const;

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
        sx={PICK_SX}
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

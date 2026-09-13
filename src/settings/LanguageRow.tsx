import { MenuItem, Select, type SelectChangeEvent } from "@mui/material";
import { useTranslation } from "react-i18next";

import { changeLanguage, type LanguageMode } from "../i18n";
import { useAppSettings } from "../lib/appSettings";
import { PICK_SX, Row } from "./Row";

const LANGUAGES: readonly LanguageMode[] = ["system", "en", "ja"];

const LANGUAGE_LABELS = {
  system: "language.system",
  en: "language.english",
  ja: "language.japanese",
} as const;

export function LanguageRow() {
  const { t } = useTranslation();
  const { language: current } = useAppSettings();

  return (
    <Row label={t("settings.language")}>
      <Select
        size="small"
        value={current}
        onChange={(event: SelectChangeEvent<LanguageMode>) => {
          const next = event.target.value as LanguageMode;
          void changeLanguage(next);
        }}
        inputProps={{ "aria-label": t("settings.language") }}
        sx={PICK_SX}
      >
        {LANGUAGES.map((option) => (
          <MenuItem key={option} value={option}>
            {t(LANGUAGE_LABELS[option])}
          </MenuItem>
        ))}
      </Select>
    </Row>
  );
}

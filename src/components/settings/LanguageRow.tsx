/** Which language the window's words are drawn in. */

import { MenuItem, Select, type SelectChangeEvent } from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";

import { changeLanguage, type LanguageMode, storedLanguage } from "../../i18n";
import { Row } from "./Row";

/** The machine's answer first, followed by each language the window carries. */
const LANGUAGES: readonly LanguageMode[] = ["system", "en", "ja"];

const LANGUAGE_LABELS = {
  system: "language.system",
  en: "language.english",
  ja: "language.japanese",
} as const;

/**
 * The language used by the window.
 *
 * The choice is applied while the settings page is still open, so every label
 * answers the press at once. Keeping `system` as a choice makes it possible to
 * give the decision back to the machine after naming a language outright.
 */
export function LanguageRow() {
  const { t } = useTranslation();
  const [current, setCurrent] = useState(storedLanguage);

  return (
    <Row label={t("settings.language")}>
      <Select
        size="small"
        value={current}
        onChange={(event: SelectChangeEvent<LanguageMode>) => {
          const next = event.target.value as LanguageMode;
          setCurrent(next);
          void changeLanguage(next);
        }}
        inputProps={{ "aria-label": t("settings.language") }}
        sx={{ minWidth: 132 }}
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

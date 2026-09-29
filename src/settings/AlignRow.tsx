import { MenuItem, Select } from "@mui/material";
import { useTranslation } from "react-i18next";
import { updateSettings, useAppSettings } from "../lib/appSettings";
import type { AppSettings } from "../lib/appSettingsModel";
import { PICK_SX, Row } from "./Row";

export function AlignRow() {
  const { t } = useTranslation();
  const { canvasAlign } = useAppSettings();
  return (
    <Row label={t("settings.canvasAlign")}>
      <Select
        size="small"
        value={canvasAlign}
        inputProps={{ "aria-label": t("settings.canvasAlign") }}
        onChange={(event) =>
          updateSettings({ canvasAlign: event.target.value as AppSettings["canvasAlign"] })
        }
        sx={PICK_SX}
      >
        <MenuItem value="terminal">{t("settings.alignTerminal")}</MenuItem>
        <MenuItem value="initial">{t("settings.alignInitial")}</MenuItem>
      </Select>
    </Row>
  );
}

import { MenuItem, Select } from "@mui/material";
import { useTranslation } from "react-i18next";
import { updateSettings, useAppSettings } from "../lib/appSettings";
import type { AppSettings } from "../lib/appSettingsModel";
import { PICK_SX, Row } from "./Row";
export function TerminalSortRow() {
  const { t } = useTranslation();
  const { terminalSort } = useAppSettings();
  return (
    <Row label={t("settings.terminalSort")}>
      <Select
        size="small"
        value={terminalSort}
        inputProps={{ "aria-label": t("settings.terminalSort") }}
        onChange={(event) =>
          updateSettings({ terminalSort: event.target.value as AppSettings["terminalSort"] })
        }
        sx={PICK_SX}
      >
        <MenuItem value="createdWhere">{t("settings.createdWhere")}</MenuItem>
        <MenuItem value="createdAt">{t("settings.createdAt")}</MenuItem>
      </Select>
    </Row>
  );
}

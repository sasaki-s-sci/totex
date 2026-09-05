/** How file paths are displayed in every panel header. */
import { MenuItem, Select } from "@mui/material";
import { useTranslation } from "react-i18next";
import { updateSettings, useAppSettings } from "../../lib/appSettings";
import { Row } from "./Row";
export function FileTitleRow() {
  const { t } = useTranslation();
  const { fileTitle } = useAppSettings();
  return (
    <Row label={t("settings.fileTitle")}>
      <Select
        size="small"
        value={fileTitle}
        inputProps={{ "aria-label": t("settings.fileTitle") }}
        onChange={(event) => updateSettings({ fileTitle: event.target.value as "name" | "path" })}
        sx={{ minWidth: 132 }}
      >
        <MenuItem value="name">{t("settings.fileName")}</MenuItem>
        <MenuItem value="path">{t("settings.fullPath")}</MenuItem>
      </Select>
    </Row>
  );
}

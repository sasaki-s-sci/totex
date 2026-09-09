import { Checkbox } from "@mui/material";
import { useTranslation } from "react-i18next";
import { updateSettings, useAppSettings } from "../../lib/appSettings";
import { Row } from "./Row";

export function BackgroundGridRow() {
  const { t } = useTranslation();
  const { backgroundGrid } = useAppSettings();

  return (
    <Row label={t("settings.backgroundGrid")}>
      <Checkbox
        size="small"
        checked={backgroundGrid}
        onChange={(event) => updateSettings({ backgroundGrid: event.target.checked })}
        slotProps={{ input: { "aria-label": t("settings.backgroundGrid") } }}
      />
    </Row>
  );
}

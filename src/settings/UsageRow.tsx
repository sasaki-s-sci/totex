import { Checkbox } from "@mui/material";
import { useTranslation } from "react-i18next";

import { updateSettings, useAppSettings } from "../lib/appSettings";
import { Row, TICK_SX } from "./Row";

export function UsageRow() {
  const { t } = useTranslation();
  const { terminalUsage } = useAppSettings();

  return (
    <Row label={t("settings.terminalUsage")}>
      <Checkbox
        size="small"
        sx={TICK_SX}
        checked={terminalUsage}
        onChange={(event) => updateSettings({ terminalUsage: event.target.checked })}
        slotProps={{ input: { "aria-label": t("settings.terminalUsage") } }}
      />
    </Row>
  );
}

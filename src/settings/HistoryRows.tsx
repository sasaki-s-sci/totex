import { Checkbox } from "@mui/material";
import { useTranslation } from "react-i18next";

import { updateSettings, useAppSettings } from "../lib/appSettings";
import { HISTORY_ALL } from "../lib/appSettingsModel";
import { Measure } from "./Measure";
import { Row, TICK_SX } from "./Row";

const ROOM = { least: 1, most: HISTORY_ALL } as const;

export function HistoryRows() {
  const { t } = useTranslation();
  const { historyLength, historyFollow } = useAppSettings();

  return (
    <>
      <Measure
        label={t("settings.historyLength")}
        value={Math.min(historyLength, HISTORY_ALL)}
        room={ROOM}
        read={(length) => (length >= HISTORY_ALL ? "∞" : `${length}`)}
        onPick={(length) =>
          updateSettings({
            historyLength: length >= HISTORY_ALL ? Number.MAX_SAFE_INTEGER : length,
          })
        }
      />
      <Row label={t("settings.historyFollow")}>
        <Checkbox
          size="small"
          sx={TICK_SX}
          checked={historyFollow}
          onChange={(event) => updateSettings({ historyFollow: event.target.checked })}
          slotProps={{ input: { "aria-label": t("settings.historyFollow") } }}
        />
      </Row>
    </>
  );
}

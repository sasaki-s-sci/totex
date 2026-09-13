import { Checkbox } from "@mui/material";
import { useTranslation } from "react-i18next";

import { updateSettings, useAppSettings } from "../lib/appSettings";
import { GRID, GRID_OFF } from "../lib/grid";
import { Measure } from "./Measure";
import { Row, TICK_SX } from "./Row";

const ROOM = { least: GRID.least, most: GRID_OFF } as const;

export function GridRows() {
  const { t } = useTranslation();
  const { backgroundGrid, gridStep, gridSnap } = useAppSettings();

  return (
    <>
      <Measure
        label={t("settings.grid")}
        value={backgroundGrid ? gridStep : GRID_OFF}
        room={ROOM}
        read={(spacing) => (spacing >= GRID_OFF ? "∞" : `${spacing}px`)}
        onPick={(spacing) =>
          updateSettings(
            spacing >= GRID_OFF
              ? { backgroundGrid: false }
              : { backgroundGrid: true, gridStep: spacing },
          )
        }
      />
      <Row label={t("settings.gridSnap")}>
        <Checkbox
          size="small"
          sx={TICK_SX}
          checked={gridSnap}
          onChange={(event) => updateSettings({ gridSnap: event.target.checked })}
          slotProps={{ input: { "aria-label": t("settings.gridSnap") } }}
        />
      </Row>
    </>
  );
}

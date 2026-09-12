/** The grid behind the canvas: how fine, and what is held to it. */

import { Checkbox } from "@mui/material";
import { useTranslation } from "react-i18next";

import { updateSettings, useAppSettings } from "../../lib/appSettings";
import { GRID, GRID_OFF } from "../../lib/grid";
import { Measure } from "./Measure";
import { Row, TICK_SX } from "./Row";

/** The slider's room: every spacing, and the notch past them that is none. */
const ROOM = { least: GRID.least, most: GRID_OFF } as const;

/**
 * Two rows. The spacing is one slider that runs off its own end: a pixel apart
 * at one side, a hundred at the other, and one more notch that reads as
 * infinity — which is where the grid stops being drawn. Holding cards to the
 * lines is what the spacing is for — see `lib/grid` — so it stands under it.
 */
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

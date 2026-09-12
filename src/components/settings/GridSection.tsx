/** The grid behind the canvas: whether it is drawn, how fine, and what is held to it. */

import { Checkbox, Divider } from "@mui/material";
import { useTranslation } from "react-i18next";

import { updateSettings, useAppSettings } from "../../lib/appSettings";
import { GRID, GRID_STEP } from "../../lib/grid";
import { Measure } from "./Measure";
import { Row } from "./Row";

/**
 * Three rows under one name. The lines and the spacing are one thing seen two
 * ways, and holding cards to the lines is what the spacing is for — see
 * `lib/grid` — so they are read together, against the hint that says what the
 * three of them are about.
 */
export function GridSection() {
  const { t } = useTranslation();
  const { backgroundGrid, gridStep, gridSnap } = useAppSettings();

  return (
    <>
      <Divider />
      <Row label={t("settings.grid")} hint={t("settings.gridHint")} />
      <Row label={t("settings.backgroundGrid")}>
        <Checkbox
          size="small"
          checked={backgroundGrid}
          onChange={(event) => updateSettings({ backgroundGrid: event.target.checked })}
          slotProps={{ input: { "aria-label": t("settings.backgroundGrid") } }}
        />
      </Row>
      <Measure
        label={t("settings.gridStep")}
        value={gridStep}
        room={GRID}
        step={GRID_STEP}
        unit="px"
        onPick={(gridStep) => updateSettings({ gridStep })}
      />
      <Row label={t("settings.gridSnap")}>
        <Checkbox
          size="small"
          checked={gridSnap}
          onChange={(event) => updateSettings({ gridSnap: event.target.checked })}
          slotProps={{ input: { "aria-label": t("settings.gridSnap") } }}
        />
      </Row>
    </>
  );
}

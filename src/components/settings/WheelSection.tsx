/** How far one notch of the wheel goes, in a terminal and on the canvas. */

import { Divider } from "@mui/material";
import { useTranslation } from "react-i18next";

import { updateSettings } from "../../lib/appSettings";
import { useWheel, WHEEL, WHEEL_STEP } from "../../lib/wheel";
import { Measure } from "./Measure";
import { Row } from "./Row";

/**
 * Two measures under one name, because they are the same question asked of two
 * places — see `lib/wheel` for why the places are asked separately. The row
 * that names them has nothing on its right: it is the hint that does the work,
 * saying what a hundred means, and the measures under it are read against it.
 */
export function WheelSection() {
  const { t } = useTranslation();
  const cli = useWheel("cli");
  const graph = useWheel("graph");

  return (
    <>
      <Divider />
      <Row label={t("settings.wheel")} hint={t("settings.wheelHint")} />
      <Measure
        label={t("settings.wheelCli")}
        value={cli}
        room={WHEEL}
        step={WHEEL_STEP}
        unit="%"
        onPick={(cliWheel) => updateSettings({ cliWheel })}
      />
      <Measure
        label={t("settings.wheelGraph")}
        value={graph}
        room={WHEEL}
        step={WHEEL_STEP}
        unit="%"
        onPick={(graphWheel) => updateSettings({ graphWheel })}
      />
    </>
  );
}

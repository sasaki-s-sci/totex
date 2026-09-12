/** How far one notch of the wheel goes, in one of the two places it is heard. */

import { useTranslation } from "react-i18next";

import { updateSettings } from "../../lib/appSettings";
import { useWheel, WHEEL, WHEEL_STEP, type WheelPlace } from "../../lib/wheel";
import { Measure } from "./Measure";

const KEYS = { cli: "cliWheel", graph: "graphWheel" } as const;

/**
 * One measure, asked once under each of the two parts of the page it belongs
 * to — see `lib/wheel` for why the places are asked separately. The same word
 * on both rows: which place is which is said by the heading over it.
 */
export function WheelRow({ place }: { place: WheelPlace }) {
  const { t } = useTranslation();
  const value = useWheel(place);

  return (
    <Measure
      label={t("settings.wheel")}
      value={value}
      room={WHEEL}
      step={WHEEL_STEP}
      unit="%"
      onPick={(next) => updateSettings({ [KEYS[place]]: next })}
    />
  );
}

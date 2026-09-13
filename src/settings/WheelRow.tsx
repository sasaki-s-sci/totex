import { useTranslation } from "react-i18next";

import { updateSettings } from "../lib/appSettings";
import { useWheel, WHEEL, WHEEL_STEP, type WheelPlace } from "../lib/wheel";
import { Measure } from "./Measure";

const KEYS = { cli: "cliWheel", graph: "graphWheel" } as const;

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

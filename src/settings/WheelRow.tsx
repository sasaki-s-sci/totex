import { useTranslation } from "react-i18next";

import { updateSettings } from "../lib/appSettings";
import { useWheel, WHEEL, WHEEL_STEP } from "../lib/wheel";
import { Measure } from "./Measure";

export function WheelRow() {
  const { t } = useTranslation();
  const value = useWheel("cli");

  return (
    <Measure
      label={t("settings.wheel")}
      value={value}
      room={WHEEL}
      step={WHEEL_STEP}
      unit="%"
      onPick={(next) => updateSettings({ cliWheel: next })}
    />
  );
}

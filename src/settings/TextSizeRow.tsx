import { useTranslation } from "react-i18next";

import { updateSettings, useAppSettings } from "../lib/appSettings";
import { Measure } from "./Measure";

/** Percent of the size each text is drawn at; 100 is the size without any change. */
export const TEXT_SIZE = { least: 50, most: 200, start: 100 } as const;

export function TextSizeRow({ place }: { place: "page" | "terminal" | "card" }) {
  const { t } = useTranslation();
  const settings = useAppSettings();
  const key = `${place}Text` as const;

  return (
    <Measure
      label={t(`settings.${key}`)}
      value={settings[key]}
      room={TEXT_SIZE}
      step={10}
      unit="%"
      onPick={(next) => updateSettings({ [key]: next })}
    />
  );
}

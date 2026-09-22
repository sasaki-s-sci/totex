import { useTranslation } from "react-i18next";

import { updateSettings, useAppSettings } from "../lib/appSettings";
import { GROUP_GAP } from "../lib/graph";
import { Measure } from "./Measure";

const ROOM = { least: GROUP_GAP.least, most: GROUP_GAP.most } as const;

/** Grid rows of air between one repository or folder and the next, measured from their outermost nodes. */
export function GapRow() {
  const { t } = useTranslation();
  const { groupGap } = useAppSettings();

  return (
    <Measure
      label={t("settings.groupGap")}
      value={Math.min(Math.max(groupGap, ROOM.least), ROOM.most)}
      room={ROOM}
      onPick={(rows) => updateSettings({ groupGap: rows })}
    />
  );
}

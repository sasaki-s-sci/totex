import { useTranslation } from "react-i18next";

import { updateSettings, useAppSettings } from "../lib/appSettings";
import { Measure } from "./Measure";

// The same bounds the backend holds the settings file to.
const ROOM = { least: 10, most: 1000 } as const;

/** How many steps back Ctrl+Z can take a file being edited. */
export function UndoRow() {
  const { t } = useTranslation();
  const { undoDepth } = useAppSettings();

  return (
    <Measure
      label={t("settings.undoDepth")}
      value={Math.min(Math.max(undoDepth, ROOM.least), ROOM.most)}
      room={ROOM}
      step={10}
      onPick={(steps) => updateSettings({ undoDepth: steps })}
    />
  );
}

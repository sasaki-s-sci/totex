import { useTranslation } from "react-i18next";

import { CLI_MARK, FOLDER_MARK, useMarkSizes } from "../canvas/markSizes";
import { updateSettings } from "../lib/appSettings";
import { Measure } from "./Measure";

const px = (size: number) => `${size}px`;

/** How large the canvas draws its terminal and folder marks. */
export function MarkSizeRows() {
  const { t } = useTranslation();
  const sizes = useMarkSizes();

  return (
    <>
      <Measure
        label={t("settings.cliMarkSize")}
        value={sizes.cli}
        room={CLI_MARK}
        read={px}
        onPick={(size) => updateSettings({ cliMarkSize: size })}
      />
      <Measure
        label={t("settings.folderMarkSize")}
        value={sizes.folder}
        room={FOLDER_MARK}
        read={px}
        onPick={(size) => updateSettings({ folderMarkSize: size })}
      />
    </>
  );
}

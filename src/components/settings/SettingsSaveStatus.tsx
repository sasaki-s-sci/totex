/** Persistence failures remain visible until the document can be saved again. */
import { Alert, Button } from "@mui/material";
import { useTranslation } from "react-i18next";
import { flushSettings, loadSettings, useSettingsError } from "../../lib/appSettings";
export function SettingsSaveStatus() {
  const { t } = useTranslation();
  const error = useSettingsError();
  if (!error) return null;
  return (
    <Alert
      severity="error"
      action={
        <Button
          color="inherit"
          onClick={() => {
            void loadSettings().then(flushSettings);
          }}
        >
          {t("settings.retrySave")}
        </Button>
      }
    >
      {t("settings.saveFailed")} {error}
    </Alert>
  );
}

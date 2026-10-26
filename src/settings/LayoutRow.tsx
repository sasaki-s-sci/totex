import { ToggleButton, ToggleButtonGroup } from "@mui/material";
import { useTranslation } from "react-i18next";
import { updateSettings, useAppSettings } from "../lib/appSettings";
import { Row } from "./Row";

export function LayoutRow() {
  const { t } = useTranslation();
  const { layout } = useAppSettings();
  return (
    <Row label={t("cards.layout")}>
      <ToggleButtonGroup
        value={layout}
        exclusive
        size="small"
        aria-label={t("cards.layout")}
        onChange={(_event, value) => {
          if (value) updateSettings({ layout: value });
        }}
      >
        <ToggleButton value="cards">{t("cards.title")}</ToggleButton>
        <ToggleButton value="canvas">Canvas</ToggleButton>
      </ToggleButtonGroup>
    </Row>
  );
}

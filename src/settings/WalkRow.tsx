import { Checkbox } from "@mui/material";
import { useTranslation } from "react-i18next";

import { setWrapping, useWrapping } from "../lib/walk";
import { Row, TICK_SX } from "./Row";

export function WalkRow() {
  const { t } = useTranslation();
  const wrapping = useWrapping();

  return (
    <Row label={t("settings.walkWrap")}>
      <Checkbox
        size="small"
        sx={TICK_SX}
        checked={wrapping}
        onChange={(event) => setWrapping(event.target.checked)}
        slotProps={{ input: { "aria-label": t("settings.walkWrap") } }}
      />
    </Row>
  );
}

import { Checkbox } from "@mui/material";
import { useTranslation } from "react-i18next";

import { setKeepingSpare, useKeepingSpare } from "../lib/spare";
import { Row, TICK_SX } from "./Row";

export function SpareRow() {
  const { t } = useTranslation();
  const spare = useKeepingSpare();

  return (
    <Row label={t("settings.spareWorktree")}>
      <Checkbox
        size="small"
        sx={TICK_SX}
        checked={spare}
        onChange={(event) => setKeepingSpare(event.target.checked)}
        slotProps={{ input: { "aria-label": t("settings.spareWorktree") } }}
      />
    </Row>
  );
}

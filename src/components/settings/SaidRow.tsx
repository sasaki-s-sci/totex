/** Whether the canvas keeps the terminals' lines on without Ctrl being held. */

import Checkbox from "@mui/material/Checkbox";
import { useTranslation } from "react-i18next";

import { setShowingSaid, useShowingSaid } from "../../lib/said";
import { Row } from "./Row";

/**
 * The one setting here about what the canvas draws by itself, so the hint is
 * what it will draw and where the key comes into it: the line is there under
 * Ctrl either way, and this is only whether letting go takes it away again.
 */
export function SaidRow() {
  const { t } = useTranslation();
  const showing = useShowingSaid();

  return (
    <Row label={t("settings.said")} hint={t("settings.saidHint")}>
      <Checkbox
        size="small"
        checked={showing}
        onChange={(event) => setShowingSaid(event.target.checked)}
        slotProps={{ input: { "aria-label": t("settings.said") } }}
      />
    </Row>
  );
}

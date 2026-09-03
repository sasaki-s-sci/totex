/** How far the canvas moves to keep the walk in view. */

import { MenuItem, Select, type SelectChangeEvent } from "@mui/material";
import { useTranslation } from "react-i18next";

import { REVEALS, type Reveal, setRevealing, useRevealing } from "../../lib/reveal";
import { Row } from "./Row";

/** What each of the three is called. */
const REVEAL_LABELS = {
  never: "reveal.never",
  edge: "reveal.edge",
  centre: "reveal.centre",
} as const satisfies Record<Reveal, string>;

/**
 * How much the canvas is moved by a walk with the cursor keys.
 *
 * The other setting on this page about what the window does rather than what it
 * looks like, and the one that is about the keys: the light on the commit says
 * where the walk has got to, and this is whether the canvas goes there with it.
 * A pull-down rather than a checkbox because the middle of the three is neither
 * of the other two — it is the least a canvas can move and still not lose the
 * mark off the side of the pane, which is what the window has always done.
 */
export function RevealRow() {
  const { t } = useTranslation();
  const revealing = useRevealing();

  return (
    <Row label={t("settings.reveal")} hint={t("settings.revealHint")}>
      <Select
        size="small"
        value={revealing}
        onChange={(event: SelectChangeEvent<Reveal>) => setRevealing(event.target.value as Reveal)}
        inputProps={{ "aria-label": t("settings.reveal") }}
        sx={{ minWidth: 132 }}
      >
        {REVEALS.map((option) => (
          <MenuItem key={option} value={option}>
            {t(REVEAL_LABELS[option])}
          </MenuItem>
        ))}
      </Select>
    </Row>
  );
}

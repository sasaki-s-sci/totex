import { MenuItem, Select, type SelectChangeEvent } from "@mui/material";
import { useTranslation } from "react-i18next";

import { REVEALS, type Reveal, setRevealing, useRevealing } from "../lib/reveal";
import { PICK_SX, Row } from "./Row";

const REVEAL_LABELS = {
  never: "reveal.never",
  edge: "reveal.edge",
  centre: "reveal.centre",
} as const satisfies Record<Reveal, string>;

export function RevealRow() {
  const { t } = useTranslation();
  const revealing = useRevealing();

  return (
    <Row label={t("settings.reveal")}>
      <Select
        size="small"
        value={revealing}
        onChange={(event: SelectChangeEvent<Reveal>) => setRevealing(event.target.value as Reveal)}
        inputProps={{ "aria-label": t("settings.reveal") }}
        sx={PICK_SX}
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

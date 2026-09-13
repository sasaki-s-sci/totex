import { Checkbox, MenuItem, Select, type SelectChangeEvent, Stack } from "@mui/material";
import { useTranslation } from "react-i18next";

import {
  LINES,
  OPACITY,
  type SaidFace,
  SIZE,
  saidStrength,
  setSaid,
  setSaidStrength,
  useSaid,
  WIDTH,
} from "../lib/said";
import { Measure } from "./Measure";
import { PICK_SX, Row, TICK_SX } from "./Row";

const FACES: readonly SaidFace[] = ["terminal", "window"];

const FACE_LABELS = {
  terminal: "said.terminal",
  window: "said.window",
} as const;

const STRENGTH = { least: 0, most: OPACITY.most } as const;

export function SaidRows() {
  const { t } = useTranslation();
  const said = useSaid();

  return (
    <>
      <Measure
        label={t("settings.said")}
        value={saidStrength(said)}
        room={STRENGTH}
        unit="%"
        onPick={setSaidStrength}
      />
      <Row label={t("settings.saidFace")}>
        <Select
          size="small"
          value={said.face}
          onChange={(event: SelectChangeEvent<SaidFace>) =>
            setSaid({ face: event.target.value as SaidFace })
          }
          inputProps={{ "aria-label": t("settings.saidFace") }}
          sx={PICK_SX}
        >
          {FACES.map((option) => (
            <MenuItem key={option} value={option}>
              {t(FACE_LABELS[option])}
            </MenuItem>
          ))}
        </Select>
      </Row>
      <Measure
        label={t("settings.saidSize")}
        value={said.size}
        room={SIZE}
        onPick={(size) => setSaid({ size })}
      />
      <Row label={t("settings.saidFit")}>
        <Checkbox
          size="small"
          sx={TICK_SX}
          checked={said.fitting}
          onChange={(event) => setSaid({ fitting: event.target.checked })}
          slotProps={{ input: { "aria-label": t("settings.saidFit") } }}
        />
      </Row>
      <Stack sx={{ gap: 0.5, opacity: said.fitting ? 0.5 : 1 }}>
        <Measure
          label={t("settings.saidLines")}
          value={said.lines}
          room={LINES}
          disabled={said.fitting}
          onPick={(lines) => setSaid({ lines })}
        />
        <Measure
          label={t("settings.saidWidth")}
          value={said.width}
          room={WIDTH}
          step={20}
          disabled={said.fitting}
          onPick={(width) => setSaid({ width })}
        />
      </Stack>
    </>
  );
}

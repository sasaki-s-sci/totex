/** The line beside a terminal: how solid it stands on its own, and how it is set. */

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
} from "../../lib/said";
import { Measure } from "./Measure";
import { PICK_SX, Row, TICK_SX } from "./Row";

/** The two faces, in the order they are offered. The terminal's own is first
 *  because it is what the line was always set in. */
const FACES: readonly SaidFace[] = ["terminal", "window"];

const FACE_LABELS = {
  terminal: "said.terminal",
  window: "said.window",
} as const;

/** The first slider's room: off at nought, and every strength above it. */
const STRENGTH = { least: 0, most: OPACITY.most } as const;

/**
 * How the lines beside the terminals are drawn, and how solidly they are drawn
 * without being asked.
 *
 * The first row makes the rest of them worth having. The line is there under
 * Ctrl whatever this page says, and that is a line glanced at: the size it has
 * always been is the right size for something read in the second before the
 * key comes back up. A window told to keep them on is a window where those
 * lines are being read all day, and the measures underneath are what that asks
 * for. The first row is a slider rather than a tick because a line kept on is
 * also a line somebody may want fainter — see `lib/said`.
 *
 * The last of them is not a measure. Two of the four — how wide and how many
 * lines — have an answer the canvas can work out for itself, out of how much of
 * it is on screen and how far apart its own rows are, and this is whether it
 * should. What it leaves alone is the face and the size, which are about
 * eyesight rather than room: no amount of canvas makes eight pixels readable.
 */
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

      {/* The two the canvas can answer for itself, and the choice of whether it
          should. It stands above them rather than below, because what it does
          is take the two rows under it out of somebody's hands. */}
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

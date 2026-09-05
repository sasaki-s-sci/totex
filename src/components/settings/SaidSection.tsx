/** The line beside a terminal: whether it stands on its own, and how it is set. */

import {
  Checkbox,
  Divider,
  MenuItem,
  Select,
  type SelectChangeEvent,
  Slider,
  Stack,
  Typography,
} from "@mui/material";
import { useTranslation } from "react-i18next";

import { LINES, type SaidFace, SIZE, setSaid, useSaid, WIDTH } from "../../lib/said";
import { Row } from "./Row";

/** The two faces, in the order they are offered. The terminal's own is first
 *  because it is what the line was always set in. */
const FACES: readonly SaidFace[] = ["terminal", "window"];

const FACE_LABELS = {
  terminal: "said.terminal",
  window: "said.window",
} as const;

/** A numeric preference with a slider and its current value. */
function Measure({
  label,
  value,
  room,
  step = 1,
  disabled,
  onPick,
}: {
  label: string;
  value: number;
  room: { least: number; most: number };
  /** How far apart the numbers offered are, where every one of them is too many. */
  step?: number;
  disabled?: boolean;
  onPick: (next: number) => void;
}) {
  return (
    <Row label={label}>
      <Stack direction="row" sx={{ alignItems: "center", gap: 2, width: 180 }}>
        <Slider
          size="small"
          aria-label={label}
          value={value}
          min={room.least}
          max={room.most}
          step={step}
          disabled={disabled}
          onChange={(_, next) => {
            if (typeof next === "number") onPick(next);
          }}
        />
        <Typography
          variant="body2"
          sx={{ minWidth: 28, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
        >
          {value}
        </Typography>
      </Stack>
    </Row>
  );
}

/**
 * How the lines beside the terminals are drawn, and whether they are drawn
 * without being asked.
 *
 * A section rather than a row, because the first choice makes the rest of them
 * worth making. The line is there under Ctrl whatever this page says, and that
 * is a line glanced at: the size it has always been is the right size for
 * something read in the second before the key comes back up. A window told to
 * keep them on is a window where those lines are being read all day, and the
 * measures underneath are what that asks for.
 *
 * The last of them is not a measure. Two of the four — how wide and how many
 * lines — have an answer the canvas can work out for itself, out of how much of
 * it is on screen and how far apart its own rows are, and this is whether it
 * should. What it leaves alone is the face and the size, which are about
 * eyesight rather than room: no amount of canvas makes eight pixels readable.
 */
export function SaidSection() {
  const { t } = useTranslation();
  const said = useSaid();

  return (
    <>
      <Divider />
      <Row label={t("settings.said")} hint={t("settings.saidHint")}>
        <Checkbox
          size="small"
          checked={said.showing}
          onChange={(event) => setSaid({ showing: event.target.checked })}
          slotProps={{ input: { "aria-label": t("settings.said") } }}
        />
      </Row>

      <Row label={t("settings.saidFace")}>
        <Select
          size="small"
          value={said.face}
          onChange={(event: SelectChangeEvent<SaidFace>) =>
            setSaid({ face: event.target.value as SaidFace })
          }
          inputProps={{ "aria-label": t("settings.saidFace") }}
          sx={{ minWidth: 132 }}
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
      <Row label={t("settings.saidFit")} hint={t("settings.saidFitHint")}>
        <Checkbox
          size="small"
          checked={said.fitting}
          onChange={(event) => setSaid({ fitting: event.target.checked })}
          slotProps={{ input: { "aria-label": t("settings.saidFit") } }}
        />
      </Row>

      <Stack sx={{ gap: 1, opacity: said.fitting ? 0.5 : 1 }}>
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

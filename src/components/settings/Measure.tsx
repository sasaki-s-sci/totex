/** A numeric preference with a slider and its current value. */

import { Slider, Stack, Typography } from "@mui/material";
import { Row } from "./Row";

export function Measure({
  label,
  value,
  room,
  step = 1,
  unit = "",
  disabled,
  onPick,
}: {
  label: string;
  value: number;
  room: { least: number; most: number };
  /** How far apart the numbers offered are, where every one of them is too many. */
  step?: number;
  /** What the number is counted in, where it is not obvious — drawn after it. */
  unit?: string;
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
          {unit}
        </Typography>
      </Stack>
    </Row>
  );
}

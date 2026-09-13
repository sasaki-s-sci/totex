import { Slider, Stack, Typography } from "@mui/material";
import { Row } from "./Row";

export function Measure({
  label,
  value,
  room,
  step = 1,
  unit = "",
  read,
  disabled,
  onPick,
}: {
  label: string;
  value: number;
  room: { least: number; most: number };
  step?: number;
  unit?: string;
  read?: (value: number) => string;
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
          {read ? read(value) : `${value}${unit}`}
        </Typography>
      </Stack>
    </Row>
  );
}

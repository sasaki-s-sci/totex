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
      <Stack
        direction="row"
        sx={{ alignItems: "center", gap: 1.5, width: 180, minWidth: 96, flexShrink: 4 }}
      >
        <Slider
          size="small"
          sx={{ flex: 1, minWidth: 0 }}
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
          sx={{ minWidth: 36, textAlign: "right", fontVariantNumeric: "tabular-nums" }}
        >
          {read ? read(value) : `${value}${unit}`}
        </Typography>
      </Stack>
    </Row>
  );
}

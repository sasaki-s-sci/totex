import { MenuItem, Select, Stack, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { PICK_SX, ROW_HEIGHT } from "./Row";

import { LATEST, type Standing } from "./updateReading";

const NAME = 96;

/** The caption starts where the versions do: past the name column and the row gap. */
const HINT_INDENT = `${NAME + 12}px`;

function VersionMove({ standing }: { standing: Standing }) {
  const { at, to } = standing;
  return (
    <Stack
      direction="row"
      sx={{ alignItems: "baseline", gap: 0.75, whiteSpace: "nowrap", minWidth: 0 }}
    >
      <Typography variant="body2" sx={{ color: to ? "text.secondary" : "text.primary" }}>
        {at}
      </Typography>
      {to && (
        <>
          <Typography variant="body2" sx={{ color: "text.disabled" }}>
            →
          </Typography>
          <Typography variant="body2" sx={{ color: "primary.main", fontWeight: 600 }}>
            {to}
          </Typography>
        </>
      )}
    </Stack>
  );
}

function Latest({ version }: { version: string | null }) {
  return (
    <Stack component="span" direction="row" sx={{ alignItems: "baseline", gap: 0.5, minWidth: 0 }}>
      {version && <span>{version}</span>}
      <Typography component="span" variant="caption" sx={{ color: "text.secondary" }}>
        {LATEST}
      </Typography>
    </Stack>
  );
}

// A pinned version the release page no longer offers stays shown, greyed, rather than dropped.
function VersionSelect({
  label,
  standing,
  disabled,
  onChange,
  blockedHint,
}: {
  label: string;
  blockedHint: string;
  standing: Standing;
  disabled: boolean;
  onChange: (version: string | null) => void;
}) {
  const { can, picked, choices, blocked, latest } = standing;
  const held =
    picked &&
    picked !== LATEST &&
    ![...choices, ...blocked].some((choice) => choice.version === picked)
      ? picked
      : null;
  return (
    <Select
      size="small"
      value={picked}
      displayEmpty
      disabled={disabled || !can || choices.length === 0}
      renderValue={(version) => (version === LATEST ? <Latest version={latest} /> : version || "—")}
      onChange={(event) => {
        const version = event.target.value;
        if (version === LATEST) onChange(null);
        else if (choices.some((choice) => choice.version === version)) onChange(version);
      }}
      inputProps={{ "aria-label": label }}
      sx={PICK_SX}
    >
      {!picked && <MenuItem value="">—</MenuItem>}
      <MenuItem value={LATEST}>
        <Latest version={latest} />
      </MenuItem>
      {held && (
        <MenuItem value={held} disabled>
          {held}
        </MenuItem>
      )}
      {choices.map((choice) => (
        <MenuItem key={choice.version} value={choice.version}>
          {choice.version}
        </MenuItem>
      ))}
      {blocked.map((choice) => (
        <MenuItem key={choice.version} value={choice.version} disabled>
          {choice.version} — {blockedHint}
        </MenuItem>
      ))}
    </Select>
  );
}

/** One layer: its name, the version move it would make, the pin, its button and what it costs. */
export function VersionRow({
  name,
  hint,
  standing,
  disabled,
  onChange,
  blockedHint,
  children,
}: {
  name: string;
  hint: string;
  blockedHint: string;
  standing: Standing;
  disabled: boolean;
  onChange: (version: string | null) => void;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Stack sx={{ gap: 0.25 }}>
      <Stack
        direction="row"
        sx={{
          alignItems: "center",
          gap: 1.5,
          rowGap: 0.5,
          minHeight: ROW_HEIGHT,
          // A long button label (the whole of "adjusting") takes the next line rather
          // than the room the versions are being read in.
          flexWrap: "wrap",
        }}
      >
        <Typography variant="body2" sx={{ width: NAME, flexShrink: 0, color: "text.secondary" }}>
          {name}
        </Typography>
        <Stack sx={{ flex: 1, minWidth: 0 }}>
          <VersionMove standing={standing} />
        </Stack>
        <Stack direction="row" sx={{ alignItems: "center", gap: 1.5, flexShrink: 0, ml: "auto" }}>
          <VersionSelect
            label={t("update.pin", { name })}
            standing={standing}
            blockedHint={blockedHint}
            disabled={disabled}
            onChange={onChange}
          />
          {children}
        </Stack>
      </Stack>
      <Typography variant="caption" sx={{ pl: HINT_INDENT, color: "text.secondary" }}>
        {hint}
      </Typography>
    </Stack>
  );
}

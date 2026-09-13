import { MenuItem, Select, Stack, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { ROW_HEIGHT } from "./Row";

import { LATEST, type Standing } from "./updateReading";

const NAME = 96;

const PICK = 132;

function VersionMove({ standing }: { standing: Standing }) {
  const { t } = useTranslation();
  const { at, aside, to } = standing;
  return (
    <Stack
      direction="row"
      sx={{ alignItems: "baseline", gap: 0.75, whiteSpace: "nowrap", minWidth: 0 }}
    >
      <Typography variant="body2" sx={{ color: to ? "text.secondary" : "text.primary" }}>
        {at}
      </Typography>
      {aside && (
        <Typography variant="caption" sx={{ color: "text.secondary" }}>
          {t(aside.part === "pages" ? "update.pagesAt" : "update.programAt", {
            version: aside.version,
          })}
        </Typography>
      )}
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
      sx={{ minWidth: PICK }}
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

export function VersionRow({
  name,
  standing,
  disabled,
  onChange,
  blockedHint,
}: {
  name: string;
  blockedHint: string;
  standing: Standing;
  disabled: boolean;
  onChange: (version: string | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <Stack direction="row" sx={{ alignItems: "center", gap: 1.5, minHeight: ROW_HEIGHT }}>
      <Typography variant="body2" sx={{ width: NAME, flexShrink: 0, color: "text.secondary" }}>
        {name}
      </Typography>
      <Stack sx={{ flex: 1, minWidth: 0 }}>
        <VersionMove standing={standing} />
      </Stack>
      <VersionSelect
        label={t("update.pin", { name })}
        standing={standing}
        blockedHint={blockedHint}
        disabled={disabled}
        onChange={onChange}
      />
    </Stack>
  );
}

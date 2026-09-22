import { MenuItem, Select, Stack, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { LATEST, type Reading } from "../lib/update";
import { PICK_SX, Row } from "./Row";

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
  read,
  disabled,
  onChange,
}: {
  read: Reading;
  disabled: boolean;
  onChange: (version: string | null) => void;
}) {
  const { t } = useTranslation();
  const { can, picked, choices, blocked, latest } = read;
  const held =
    picked !== LATEST && ![...choices, ...blocked].some((choice) => choice.version === picked)
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
      inputProps={{ "aria-label": t("update.pin") }}
      sx={PICK_SX}
    >
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
          {choice.version} — {t("update.unavailable")}
        </MenuItem>
      ))}
    </Select>
  );
}

/** Update actions and the version selection share one settings row. */
export function VersionRow({
  read,
  disabled,
  onChange,
  children,
}: {
  read: Reading;
  disabled: boolean;
  onChange: (version: string | null) => void;
  children?: React.ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Row label={t("update.version")}>
      <Stack direction="row" sx={{ alignItems: "center", gap: 1, flexWrap: "nowrap" }}>
        {children}
        <VersionSelect read={read} disabled={disabled} onChange={onChange} />
      </Stack>
    </Row>
  );
}

import { MenuItem, Select, Stack, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";
import { LATEST, type Reading } from "../lib/update";
import { PICK_SX, ROW_HEIGHT } from "./Row";

const NAME = 96;

/** The buttons start where the versions do: past the name column and the row gap. */
const INDENT = `${NAME + 12}px`;

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

/** The one row: what is drawn, the pin, and the two buttons. */
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
    <Stack sx={{ gap: 0.5 }}>
      <Stack
        direction="row"
        sx={{
          alignItems: "center",
          gap: 1.5,
          rowGap: 0.5,
          minHeight: ROW_HEIGHT,
          flexWrap: "wrap",
        }}
      >
        <Typography variant="body2" sx={{ width: NAME, flexShrink: 0, color: "text.secondary" }}>
          {t("update.version")}
        </Typography>
        <Typography variant="body2" sx={{ flex: 1, minWidth: 0, whiteSpace: "nowrap" }}>
          {read.at}
        </Typography>
        <VersionSelect read={read} disabled={disabled} onChange={onChange} />
      </Stack>
      {/* A patch and a minor, side by side. */}
      <Stack direction="row" sx={{ pl: INDENT, gap: 1.5, rowGap: 0.5, flexWrap: "wrap" }}>
        {children}
      </Stack>
    </Stack>
  );
}

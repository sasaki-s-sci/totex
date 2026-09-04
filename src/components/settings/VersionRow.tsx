/**
 * One declared version: what this copy is on, where the one press above would
 * take it, and the pull-down that pins it somewhere else.
 */

import { MenuItem, Select, Stack, Typography } from "@mui/material";
import { useTranslation } from "react-i18next";

import { LATEST, type Standing } from "./updateReading";

/**
 * The column the two names are set in.
 *
 * Wide enough for either of them, so that the versions start at the same place
 * on both rows and can be read down rather than across: two numbers under one
 * another is a comparison, and two numbers at different indents is a list.
 */
const NAME = 96;

/** The width of the pull-down, held so a longer version does not move the row. */
const PICK = 132;

/**
 * What this half of the app is on, and — where a press would change it — what
 * it would become.
 *
 * The version in place is the one thing here that is always drawn, because it
 * is the one thing that is always true. What it would become is drawn beside it
 * only when the two differ, which is what makes an arrow on this page mean
 * something: no arrow is nothing to do.
 *
 * The one leaving is set in the muted ink and the one arriving in the accent —
 * the same way round as everything else in the window that is going somewhere.
 */
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

/**
 * `latest` as it reads in the pull-down: the release it is on today, with the
 * word itself behind it in the small grey.
 *
 * The word on its own says nothing about where it points, and a copy whose
 * program cannot move follows the newest release its program can draw the
 * pages of, which is not always the newest number there is. The version is
 * what is actually being chosen, so it is set as one; the word is only why it
 * will move again on its own, so it is set as a footnote to it.
 *
 * There is no version to show before the release page has answered once, which
 * leaves the word standing alone — which is what it meant then anyway.
 */
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

/**
 * Which release this half is pointed at: `latest`, or one named outright.
 *
 * `latest` is a declaration rather than a version — it is followed wherever it
 * goes — and naming a version is what stops that. A version this copy is
 * pointed at that the release page no longer offers is still what the row is
 * on, so it is shown, greyed, rather than quietly dropped for a version nobody
 * asked for.
 */
function VersionSelect({
  label,
  standing,
  disabled,
  onChange,
}: {
  label: string;
  standing: Standing;
  disabled: boolean;
  onChange: (version: string | null) => void;
}) {
  const { can, picked, choices, latest } = standing;
  const held =
    picked && picked !== LATEST && !choices.some((choice) => choice.version === picked)
      ? picked
      : null;
  return (
    <Select
      size="small"
      value={picked}
      displayEmpty
      // Both rows keep their pull-down, so that the page reads as two of the
      // same thing rather than one setting and one label. A half this copy
      // cannot replace keeps it shut instead of losing it: a declaration
      // nothing would act on is a control that does nothing, and the row says
      // why beside it.
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
    </Select>
  );
}

/**
 * One line of the update section: name, version, and the pin.
 *
 * The version is why the line is there — a copy that cannot update itself is
 * still a copy somebody needs to be able to say the version of — and the
 * pull-down stands on every line whether or not this copy can act on it.
 */
export function VersionRow({
  name,
  standing,
  hint,
  disabled,
  onChange,
}: {
  name: string;
  standing: Standing;
  /** The half-sentence about why this row is the shape it is, where there is one. */
  hint?: string;
  disabled: boolean;
  onChange: (version: string | null) => void;
}) {
  const { t } = useTranslation();
  return (
    <Stack direction="row" sx={{ alignItems: "center", gap: 1.5, minHeight: 34 }}>
      <Typography variant="body2" sx={{ width: NAME, flexShrink: 0, color: "text.secondary" }}>
        {name}
      </Typography>
      {/* The version and the half-sentence about it are one column, so that a
          row which has something to explain grows downwards rather than
          pushing the pull-down along. */}
      <Stack sx={{ gap: 0.25, flex: 1, minWidth: 0 }}>
        <VersionMove standing={standing} />
        {hint && (
          <Typography variant="caption" sx={{ color: "text.secondary" }}>
            {hint}
          </Typography>
        )}
      </Stack>
      <VersionSelect
        label={t("update.pin", { name })}
        standing={standing}
        disabled={disabled}
        onChange={onChange}
      />
    </Stack>
  );
}

import { MenuItem, Select, type SelectChangeEvent, TextField } from "@mui/material";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { updateSettings, useAppSettings } from "../lib/appSettings";
import { AGENTS, MODES, type Mode, type ResumeSettings, WHYS } from "../resume/model";
import { PICK_SX, Row } from "./Row";

/** Seconds, in the steps somebody would pick by: a minute up to a day. */
const WITHINS = [60, 300, 600, 1800, 3600, 21_600, 86_400] as const;

function spelled(seconds: number): string {
  return seconds < 3600 ? `${seconds / 60} min` : `${seconds / 3600} h`;
}

function setResume(next: Partial<ResumeSettings>): void {
  updateSettings({ resume: next });
}

export function ResumeRows() {
  const { t } = useTranslation();
  const resume = useAppSettings().resume;
  // A value read from a hand-edited file is still offered, beside the usual steps.
  const withins = WITHINS.includes(resume.within as (typeof WITHINS)[number])
    ? WITHINS
    : [...WITHINS, resume.within].sort((one, two) => one - two);
  // A guard command is written in the file; the page offers the two that need no words.
  const guard = resume.guard === "git" || resume.guard === "none" ? resume.guard : "cmd";

  return (
    <>
      {WHYS.map((why) => (
        <Row key={why} label={t(`resume.${why}`)}>
          <Select
            size="small"
            value={resume[why]}
            onChange={(event: SelectChangeEvent<Mode>) =>
              setResume({ [why]: event.target.value as Mode })
            }
            inputProps={{ "aria-label": t(`resume.${why}`) }}
            sx={PICK_SX}
          >
            {MODES.map((mode) => (
              <MenuItem key={mode} value={mode}>
                {t(`resume.mode.${mode}`)}
              </MenuItem>
            ))}
          </Select>
        </Row>
      ))}
      <Row label={t("resume.within")}>
        <Select
          size="small"
          value={resume.within}
          onChange={(event: SelectChangeEvent<number>) =>
            setResume({ within: Number(event.target.value) })
          }
          inputProps={{ "aria-label": t("resume.within") }}
          sx={PICK_SX}
        >
          {withins.map((seconds) => (
            <MenuItem key={seconds} value={seconds}>
              {spelled(seconds)}
            </MenuItem>
          ))}
        </Select>
      </Row>
      <Row label={t("resume.guard")}>
        <Select
          size="small"
          value={guard}
          onChange={(event: SelectChangeEvent) =>
            setResume({ guard: event.target.value === "none" ? "none" : "git" })
          }
          inputProps={{ "aria-label": t("resume.guard") }}
          sx={PICK_SX}
        >
          <MenuItem value="git">{t("resume.guardGit")}</MenuItem>
          <MenuItem value="none">{t("resume.guardNone")}</MenuItem>
          {guard === "cmd" && <MenuItem value="cmd">{resume.guard}</MenuItem>}
        </Select>
      </Row>
      <Row label={t("resume.prompt")}>
        <LineField
          label={t("resume.prompt")}
          value={resume.prompt}
          onCommit={(prompt) => setResume({ prompt })}
        />
      </Row>
      {AGENTS.map((agent) => (
        <Row key={agent} label={t("resume.agentLine", { agent })}>
          <LineField
            label={t("resume.agentLine", { agent })}
            value={resume.agents[agent]}
            onCommit={(line) => setResume({ agents: { ...resume.agents, [agent]: line } })}
          />
        </Row>
      ))}
    </>
  );
}

/** Kept as typed until the field is left: an emptied line would otherwise snap back mid-edit. */
function LineField({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <TextField
      size="small"
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft !== value) onCommit(draft);
      }}
      slotProps={{ htmlInput: { "aria-label": label, sx: { py: 0.5, fontSize: 13 } } }}
      sx={{ minWidth: 220 }}
    />
  );
}

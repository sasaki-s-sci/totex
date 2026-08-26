/** Declarative versions for the two independently moving parts of the app. */

import { Divider, FormControl, InputLabel, MenuItem, Select, Stack } from "@mui/material";
import { useEffect, useId } from "react";
import { useTranslation } from "react-i18next";
import {
  askStanding,
  declare,
  reload,
  restart,
  rungOf,
  stageOf,
  take,
  type UpdateChoice,
  type UpdateStage,
  type UpdateState,
  useUpdate,
  wanted,
} from "../../lib/update";
import { UpdateMark } from "../marks";
import { PageButton, Row } from "./Row";

const CORE_CYCLE = "layer";
const PROGRAM_CYCLE = "release";
const LATEST = "latest";

/** One compact declaration: its name and version are both visible when shut. */
function VersionSelect({
  label,
  value,
  choices,
  disabled,
  onChange,
}: {
  label: string;
  value: string;
  choices: readonly UpdateChoice[];
  disabled: boolean;
  onChange: (version: string | null) => void;
}) {
  const labelId = useId();
  const held =
    value && value !== LATEST && !choices.some((choice) => choice.version === value) ? value : null;
  return (
    <FormControl size="small" sx={{ minWidth: 146 }}>
      <InputLabel id={labelId} shrink>
        {label}
      </InputLabel>
      <Select
        labelId={labelId}
        label={label}
        value={value}
        displayEmpty
        disabled={disabled}
        renderValue={(version) => version || "—"}
        onChange={(event) => {
          const version = event.target.value;
          if (version === LATEST) onChange(null);
          else if (choices.some((choice) => choice.version === version)) onChange(version);
        }}
      >
        {!value && <MenuItem value="">—</MenuItem>}
        <MenuItem value={LATEST}>{LATEST}</MenuItem>
        {held && (
          <MenuItem value={held} disabled>
            {held}
          </MenuItem>
        )}
        {choices.map((choice) => (
          <MenuItem key={`${choice.cycle}:${choice.version}`} value={choice.version}>
            {choice.version}
          </MenuItem>
        ))}
      </Select>
    </FormControl>
  );
}

/** The dedicated Core releases whose protocol is known. */
function coreChoices(at: UpdateState): UpdateChoice[] {
  return at.choices.filter(
    (choice) => choice.cycle === CORE_CYCLE && choice.layerProtocol !== null,
  );
}

/** Which Core declaration the first pull-down currently represents. */
function selectedCore(at: UpdateState): UpdateChoice | null {
  const rung = rungOf(at, "app");
  if (!rung) return null;
  const version = rung.cycle === CORE_CYCLE ? wanted(at, "app") : rung.at;
  const released = coreChoices(at).find((choice) => choice.version === version);
  if (released) return released;
  if (version !== rung.at || rung.protocol === null) return null;
  return {
    cycle: CORE_CYCLE,
    version,
    layerProtocol: rung.protocol,
    frontContract: null,
  };
}

/** Front / Program releases compatible with the Core declaration. */
function programChoices(at: UpdateState, core: UpdateChoice | null): UpdateChoice[] {
  if (core?.layerProtocol === null || core === null) return [];
  const program = rungOf(at, "core");
  return at.choices.filter(
    (choice) =>
      choice.cycle === PROGRAM_CYCLE &&
      choice.layerProtocol === core.layerProtocol &&
      choice.frontContract !== null &&
      // A package-managed program stays where it is, so a selected front must
      // also fit the program that is actually running. Where the program can
      // move, its release carries the matching contract with it.
      (program?.can ||
        (program?.frontContract !== null &&
          program?.frontContract !== undefined &&
          choice.frontContract <= program.frontContract)),
  );
}

function selectedVersion(at: UpdateState, layer: "app" | "core", cycle: string): string {
  const rung = rungOf(at, layer);
  if (!rung) return "";
  if (rung.cycle !== cycle) return rung.at;
  return rung.picked ?? LATEST;
}

/** The strongest state to draw for the one sync in flight. */
function activity(at: UpdateState): { stage: UpdateStage; progress: number | null } {
  const layers = ["app", "core", "front"] as const;
  const presses = layers.map((layer) => ({ ...at.presses[layer], stage: stageOf(at, layer) }));
  const taking = presses.find((press) => press.stage === "taking");
  if (taking) return taking;
  if (presses.some((press) => press.stage === "failed")) {
    return { stage: "failed", progress: null };
  }
  if (presses.some((press) => press.stage === "held")) {
    return { stage: "held", progress: null };
  }
  return { stage: "current", progress: null };
}

export function UpdateSection() {
  const { t } = useTranslation();
  const at = useUpdate();

  useEffect(() => {
    void askStanding();
  }, []);

  const core = selectedCore(at);
  const cores = coreChoices(at);
  const programs = programChoices(at, core);
  const coreVersion = selectedVersion(at, "app", CORE_CYCLE);
  const programVersion = selectedVersion(at, "core", PROGRAM_CYCLE);
  const moving = (["app", "core", "front"] as const).some(
    (layer) => stageOf(at, layer) === "taking",
  );
  const mark = activity(at);
  const program = rungOf(at, "core");
  const programTarget =
    program?.picked === null
      ? programs[0]
      : programs.find((choice) => choice.version === programVersion);
  const available = core !== null && programTarget !== undefined;

  const finishProgram = async (version: string) => {
    const program = rungOf(at, "core");
    if (program?.can) {
      const stage = await take("core", version);
      if (stage === "ready") {
        restart();
        return;
      }
      if (stage === "failed") return;
    }

    const stage = await take("front", version);
    if (stage === "swapped") reload();
  };

  const chooseCore = async (version: string | null) => {
    await declare([{ layer: "app", cycle: CORE_CYCLE, version }]);
  };

  const chooseProgram = async (version: string | null) => {
    await declare([
      { layer: "front", cycle: PROGRAM_CYCLE, version },
      { layer: "core", cycle: PROGRAM_CYCLE, version },
    ]);
  };

  const sync = async () => {
    if (!core || !programTarget) return;
    const stage = await take("app", core.version);
    if (stage === "failed") return;
    await finishProgram(programTarget.version);
  };

  // A source build has no front or program to replace and no useful
  // declaration to make. Package-managed copies still draw this row because
  // they can move persistent and a compatible front independently.
  const rungs = at.rungs;
  if (rungs && !rungs.some((rung) => rung.can)) return null;

  return (
    <>
      <Divider />
      <Row
        label={t("update.title")}
        hint={
          moving
            ? t("update.adjusting")
            : mark.stage === "failed"
              ? t("update.adjustFailed")
              : mark.stage === "held"
                ? t("update.incompatible")
                : undefined
        }
      >
        <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
          <VersionSelect
            label={t("update.core")}
            value={coreVersion}
            choices={cores}
            disabled={moving || cores.length === 0}
            onChange={(version) => void chooseCore(version)}
          />
          <VersionSelect
            label={t("update.frontProgram")}
            value={programVersion}
            choices={programs}
            disabled={moving || programs.length === 0}
            onChange={(version) => void chooseProgram(version)}
          />
          <PageButton
            danger={mark.stage === "failed"}
            disabled={moving || !available}
            icon={<UpdateMark stage={mark.stage} progress={mark.progress} />}
            onClick={() => void sync()}
          >
            {t("update.sync")}
          </PageButton>
        </Stack>
      </Row>
    </>
  );
}

/**
 * Which version each half of the app is on, and the one press that brings both
 * of them forward.
 *
 * The section is drawn whenever the backend has answered at all, because the
 * first thing it says is what this copy is — a version somebody can read off
 * without having anything to do about it. Everything else is arranged around
 * that: the pull-downs name where each half should be, the arrows say where
 * that differs from where it is, and the button takes both halves there.
 */

import { Divider, Stack } from "@mui/material";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import {
  askStanding,
  declare,
  reload,
  restart,
  rungOf,
  stageOf,
  take,
  type UpdateStage,
  type UpdateState,
  useUpdate,
} from "../../lib/update";
import { UpdateMark } from "../marks";
import { PageButton, Row } from "./Row";
import {
  CORE_CYCLE,
  coreStanding,
  PROGRAM_CYCLE,
  programStanding,
  type Standing,
} from "./updateReading";
import { VersionRow } from "./VersionRow";

/**
 * The strongest state to draw for the one sync in flight.
 *
 * `offering` is what the mark falls back to with nothing in flight: the arrow
 * where there is something to take, and the tick where the page can say there
 * is not. A tick is a claim, so it is only drawn once every half that can move
 * has a release to be read against.
 */
function activity(
  at: UpdateState,
  offering: boolean,
): { stage: UpdateStage; progress: number | null } {
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
  return { stage: offering ? "rest" : "current", progress: null };
}

/** Whether every half that can move has a release it could be moved to. */
function resolved(halves: readonly Standing[]): boolean {
  return halves.every((half) => !half.can || half.target !== null);
}

export function UpdateSection() {
  const { t } = useTranslation();
  const at = useUpdate();

  useEffect(() => {
    void askStanding();
  }, []);

  const core = coreStanding(at);
  const program = programStanding(at, core?.target ?? null);
  const moving = (["app", "core", "front"] as const).some(
    (layer) => stageOf(at, layer) === "taking",
  );

  const finishProgram = async (version: string) => {
    const rung = rungOf(at, "core");
    if (rung?.can) {
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

  if (!core || !program) return null;

  // Until the release page has answered once, nothing is known — neither that
  // there is something to take nor that there is not.
  const asked = at.choices.length > 0;
  const known = asked && resolved([core, program]);
  const waiting = Boolean(core.to || program.to);
  // What the button is holding out: something to take, or a question nobody
  // has the answer to yet. Either way it is not a tick.
  const offering = waiting || !known;
  const mark = activity(at, offering);
  // A press that failed is offered again whether or not anything is still out
  // of place: the layer may well have arrived, and re-taking it is what says so
  // and takes the red off the button.
  const retry = mark.stage === "failed";

  const sync = async () => {
    if (core.can && core.target && (core.to || retry)) {
      const stage = await take("app", core.target.version);
      if (stage === "failed") return;
    }
    if (program.can && program.target && (program.to || retry)) {
      await finishProgram(program.target.version);
    }
  };

  // One word for the press whatever the rows say, because it is one press: it
  // puts this copy on the versions the rows are pointed at. Left alone they are
  // both on `latest`, so that is the whole app brought up to date; a row pinned
  // to a version makes the same press a move to that version, which may well be
  // a step backwards. What it would do is on the rows, in the arrows.
  const label = retry ? t("update.failed") : offering ? t("update.apply") : t("update.current");

  // A copy the package manager owns can still bring its pages forward, and the
  // program under them is not this window's to replace.
  const packaged = rungOf(at, "core")?.can === false && rungOf(at, "front")?.can === true;

  return (
    <>
      <Divider />
      <Row
        label={t("update.title")}
        hint={
          moving
            ? t("update.adjusting")
            : retry
              ? t("update.adjustFailed")
              : mark.stage === "held" || (asked && !known)
                ? t("update.incompatible")
                : undefined
        }
      >
        {/* A copy that can replace neither half of itself keeps its versions
            and loses the press: what is left is a page saying what this is. */}
        {(core.can || program.can) && (
          <PageButton
            danger={retry}
            disabled={moving || !(waiting || retry)}
            icon={<UpdateMark stage={mark.stage} progress={mark.progress} />}
            onClick={() => void sync()}
          >
            {label}
          </PageButton>
        )}
      </Row>
      <Stack sx={{ gap: 0.5, pl: 1.5 }}>
        <VersionRow
          name={t("update.core")}
          standing={core}
          disabled={moving}
          onChange={(version) => void chooseCore(version)}
        />
        <VersionRow
          name={t("update.frontProgram")}
          standing={program}
          hint={packaged ? t("update.held") : undefined}
          disabled={moving}
          onChange={(version) => void chooseProgram(version)}
        />
      </Stack>
    </>
  );
}

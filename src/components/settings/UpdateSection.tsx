/**
 * Which version this copy of the app is on, and the one press that brings it
 * forward.
 *
 * The section is drawn whenever the backend has answered at all, because the
 * first thing it says is what this copy is — a version somebody can read off
 * without having anything to do about it. Everything else is arranged around
 * that: the pull-down names where the app should be, the arrow says where that
 * differs from where it is, and the button takes it there.
 *
 * Two rows. **persistent** is the program holding the terminals. Which
 * releases replace it is said by the version number, and the row says what
 * that means for the release the other pull-down is on; its own pull-down
 * offers the programs this machine holds, and moving it is a restart that
 * ends every terminal, which the page says before the press. **ephemeral** is
 * this program and its pages, and is what a release replaces.
 */

import { Divider, Stack } from "@mui/material";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import {
  askStanding,
  declare,
  lineOf,
  reload,
  restart,
  restartPersistent,
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
  ephemeralStanding,
  keepsTerminals,
  persistentStanding,
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
 *
 * `ready` is read after the other three because it is the weakest thing that
 * is still not nothing: a program that is down and about to go in. Whatever
 * else the press ran into is what the mark should be saying, and where it ran
 * into nothing this is what stops the row offering the same release over
 * again while the window is on its way out.
 */
function activity(
  at: UpdateState,
  offering: boolean,
): { stage: UpdateStage; progress: number | null } {
  const layers = ["ephemeral", "front", "persistent"] as const;
  const presses = layers.map((layer) => ({ ...at.presses[layer], stage: stageOf(at, layer) }));
  const taking = presses.find((press) => press.stage === "taking");
  if (taking) return taking;
  if (presses.some((press) => press.stage === "failed")) {
    return { stage: "failed", progress: null };
  }
  if (presses.some((press) => press.stage === "held")) {
    return { stage: "held", progress: null };
  }
  if (presses.some((press) => press.stage === "ready")) {
    return { stage: "ready", progress: null };
  }
  return { stage: offering ? "rest" : "current", progress: null };
}

/** Whether the half that can move has a release it could be moved to. */
function resolved(half: Standing): boolean {
  return !half.can || half.target !== null;
}

export function UpdateSection() {
  const { t } = useTranslation();
  const at = useUpdate();

  useEffect(() => {
    void askStanding();
  }, []);

  const ephemeral = ephemeralStanding(at);
  const persistent = persistentStanding(at);
  const moving = (["ephemeral", "front", "persistent"] as const).some(
    (layer) => stageOf(at, layer) === "taking",
  );

  // The program first, and where it moves it is the whole of the ephemeral
  // half: the release it comes out of carries its own pages, and they arrive
  // with it at the restart. So the pages are taken on their own only in the
  // two places where they are the half that is behind — a program the package
  // manager owns, and a program already on the release the row is pointed at.
  const finishEphemeral = async (version: string) => {
    const rung = rungOf(at, "ephemeral");
    if (rung?.can) {
      const stage = await take("ephemeral", version);
      // `ready` is the release down and checked, and what is left is this
      // window leaving so that the next can open on it. The terminals stay:
      // they are not in this window.
      if (stage === "ready") restart();
      if (stage === "ready" || stage === "failed") return;
    }

    const stage = await take("front", version);
    if (stage === "swapped") reload();
  };

  const chooseEphemeral = async (version: string | null) => {
    await declare([
      { layer: "front", version },
      { layer: "ephemeral", version },
    ]);
  };

  const choosePersistent = async (version: string | null) => {
    await declare([{ layer: "persistent", version }]);
  };

  // The persistent half moves by a restart and not by a download, and the
  // pages are drawn again afterwards: everything they were showing of the
  // sessions is gone with the program that held them.
  const finishPersistent = async (version: string) => {
    const stage = await restartPersistent(version);
    if (stage === "current") reload();
  };

  if (!ephemeral || !persistent) return null;

  // Until the release page has answered once, nothing is known — neither that
  // there is something to take nor that there is not.
  const asked = at.choices.length > 0;
  const known = asked && resolved(ephemeral);
  // The ephemeral half first, where it has somewhere to go: the release it
  // moves to brings a persistent half with it, and that one is what the
  // persistent row is read against once the next window is up.
  const ephemeralMoves = Boolean(ephemeral.to);
  const persistentMoves = !ephemeralMoves && Boolean(persistent.to);
  const waiting = ephemeralMoves || persistentMoves;
  // What the button is holding out: something to take, or a question nobody
  // has the answer to yet. Either way it is not a tick.
  const offering = waiting || !known;
  const mark = activity(at, offering);
  // A press that failed is offered again whether or not anything is still out
  // of place: the release may well have arrived, and re-taking it is what says
  // so and takes the red off the button.
  const retry = mark.stage === "failed";
  // And a release that is down is one the row would otherwise go on offering
  // for the moment this window is still on the screen, because what is running
  // is still the program it replaces. The button stops: the window is leaving.
  const arrived = mark.stage === "ready";

  const sync = async () => {
    if (ephemeral.can && ephemeral.target && (ephemeral.to || retry)) {
      await finishEphemeral(ephemeral.target.version);
      return;
    }
    if (persistent.can && persistent.target && persistent.to) {
      await finishPersistent(persistent.target.version);
    }
  };

  // One word for the press whatever the row says, because it is one press: it
  // puts this copy on the version the row is pointed at. Left alone it is on
  // `latest`, so that is the whole app brought up to date; a row pinned to a
  // version makes the same press a move to that version, which may well be a
  // step backwards. What it would do is on the row, in the arrow.
  const label = retry
    ? t("update.failed")
    : arrived
      ? t("update.ready")
      : persistentMoves
        ? t("update.restart")
        : offering
          ? t("update.apply")
          : t("update.current");

  // A copy the package manager owns can still bring its pages forward, and the
  // program under them is not this window's to replace.
  const packaged = rungOf(at, "ephemeral")?.can === false && rungOf(at, "front")?.can === true;

  // What the release the row is pointed at would do to the terminals, said
  // before anybody presses: a patch on the persistent half's line leaves them
  // where they are, and another line does not. Only where the program itself
  // moves -- the pages alone never touch the persistent half.
  const going = ephemeral.to && rungOf(at, "ephemeral")?.can ? ephemeral.to : null;
  const stays = going === null ? null : keepsTerminals(at, going);
  const line = going === null ? null : lineOf(going);
  const terminals = persistentMoves
    ? t("update.persistentMove", { version: persistent.to })
    : stays === null || line === null
      ? undefined
      : stays
        ? t("update.stays", { line })
        : t("update.moves", { line });
  // Red before the press that ends every terminal, whichever row it is for:
  // a restart of the persistent half, or a release on another line.
  const closes = persistentMoves || (ephemeralMoves && stays === false);

  // The persistent half is behind the window only within a line: any further
  // behind and the window that found it would have replaced it.
  const behind = persistent.at !== "" && persistent.at !== ephemeral.at;

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
              : arrived
                ? t("update.readyHint")
                : mark.stage === "held" || (asked && !known)
                  ? t("update.incompatible")
                  : terminals
        }
      >
        {/* A copy that can replace neither half of itself keeps its version
            and loses the press: what is left is a page saying what this is. */}
        {(ephemeral.can || persistent.can) && (
          <PageButton
            danger={retry || closes}
            disabled={moving || arrived || !(waiting || retry)}
            icon={<UpdateMark stage={mark.stage} progress={mark.progress} />}
            onClick={() => void sync()}
          >
            {label}
          </PageButton>
        )}
      </Row>
      <Stack sx={{ gap: 0.5, pl: 1.5 }}>
        <VersionRow
          name={t("update.persistent")}
          standing={persistent}
          hint={
            behind
              ? t("update.persistentBehind", { version: ephemeral.at })
              : t("update.persistentLine")
          }
          disabled={moving}
          onChange={(version) => void choosePersistent(version)}
        />
        <VersionRow
          name={t("update.ephemeral")}
          standing={ephemeral}
          hint={packaged ? t("update.held") : undefined}
          disabled={moving}
          onChange={(version) => void chooseEphemeral(version)}
        />
      </Stack>
    </>
  );
}

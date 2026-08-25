/**
 * Replacing the app with another release of it, a layer at a time.
 */

import { Divider, ListSubheader, MenuItem, Select, Stack } from "@mui/material";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import {
  askStanding,
  CYCLES,
  type Cycle,
  LAYERS,
  type Layer,
  pick,
  type Rung,
  reload,
  restart,
  rungOf,
  stageOf,
  take,
  type UpdateStage,
  type UpdateState,
  useUpdate,
  wanted,
} from "../../lib/update";
import { UpdateMark } from "../marks";
import { PageButton, Row } from "./Row";

/**
 * What each state of a row is, which is also what a press of it does.
 *
 * Three maps rather than one, because the three layers cost different things
 * and end in different words. Each carries a word for the endings the others
 * reach — a reload never finishes a program and a restart never finishes a page
 * — so that a row is a plain lookup rather than a lookup and a special case.
 */
const WORDS = {
  front: {
    rest: "update.take",
    taking: "update.taking",
    current: "update.current",
    swapped: "update.reload",
    ready: "update.reload",
    held: "update.inProgram",
    failed: "update.failed",
  },
  app: {
    rest: "update.take",
    taking: "update.fetching",
    // The layer's ending, and it is not a thing to press: by the time the row
    // says this, the layer that was downloaded is the one answering.
    current: "update.current",
    swapped: "update.current",
    ready: "update.current",
    held: "update.inProgram",
    failed: "update.failed",
  },
  core: {
    rest: "update.take",
    // Named apart from the pages' word for the same state: this is eighty
    // megabytes and a ring that fills, and "downloading" is what that is.
    taking: "update.fetching",
    current: "update.current",
    swapped: "update.restart",
    ready: "update.restart",
    held: "update.held",
    failed: "update.failed",
  },
  // Kept as the literal keys they are, so that a name no locale carries does
  // not compile.
} as const satisfies Record<Layer, Record<UpdateStage, string>>;

/** What each row is called, and what its version line says about it. */
const NAMES = {
  front: { label: "update.pages", at: "update.drawn" },
  app: { label: "update.layer", at: "update.answering" },
  core: { label: "update.program", at: "update.running" },
} as const satisfies Record<Layer, { label: string; at: string }>;

/**
 * One layer of a release, and the one press that brings it.
 *
 * The mark is kept here rather than replaced by a word, because it is the one
 * thing on the page saying what the words do not: a ring that turns while the
 * release page is being read, and fills as the download arrives.
 *
 * Red is kept for the two endings — a restart that takes every terminal with
 * it, and a press that did not work. A reload is neither, and a layer being
 * swapped is less than neither: the program under the window is the same
 * program, and everything running in it goes on running.
 */
function LayerRow({ at, rung }: { at: UpdateState; rung: Rung }) {
  const { t } = useTranslation();
  const layer = rung.layer;
  // A layer this copy cannot have is drawn at its ending rather than left out:
  // being told the program belongs to a package manager is worth more than a
  // row that is not there.
  const stage = rung.can ? stageOf(at, layer) : "held";
  const target = wanted(at, layer);

  return (
    <Row
      label={t(NAMES[layer].label)}
      hint={
        // What is in place, and what a press would put there. Both, whenever
        // they differ, because a version on its own says nothing about which
        // way the press goes -- and going back is as much of what naming a
        // release is for as going forward.
        target && target !== rung.at
          ? t("update.moving", { from: rung.at, to: target })
          : t(NAMES[layer].at, { version: rung.at })
      }
    >
      <Stack direction="row" sx={{ alignItems: "center", gap: 1 }}>
        <Releases at={at} rung={rung} />
        <PageButton
          danger={stage === "ready" || stage === "failed"}
          disabled={stage === "taking" || stage === "held"}
          icon={<UpdateMark stage={stage} progress={at.presses[layer].progress} />}
          onClick={() => {
            if (stage === "ready") restart();
            else if (stage === "swapped") reload();
            else void take(layer);
          }}
        >
          {t(WORDS[layer][stage])}
        </PageButton>
      </Stack>
    </Row>
  );
}

/**
 * Which release one row is pointed at, out of every cycle that row may follow.
 *
 * One pull-down and not two. A cycle is not a thing anybody wants to choose —
 * what they want is a version, and which cycle it was cut on is a fact about
 * that version rather than a second decision. So the versions are grouped under
 * the cycle they came from, and taking one off the list says both.
 *
 * The list is filled on a slow loop from the moment the window opens — see
 * `watchVersions` — so it is full when it is opened rather than after. A window
 * that has never had one offers the newest release instead, which is what every
 * press meant before a version could be named at all.
 */
function Releases({ at, rung }: { at: UpdateState; rung: Rung }) {
  const { t } = useTranslation();
  const layer = rung.layer;
  const cycles = CYCLES[layer].filter(
    (cycle) => cycle === "release" || at.versions[cycle].length > 0,
  );
  const taking = at.presses[layer].stage === "taking";
  // The value is the cycle and the version together, because 0.1.9 of one cycle
  // is not 0.1.9 of another and a list holding both would have two rows that
  // are the same string.
  const value = rung.picked ? `${rung.cycle}:${rung.picked}` : "";

  return (
    <Select
      size="small"
      value={value}
      disabled={taking}
      onChange={(event) => {
        const [cycle, version] = event.target.value.split(":");
        void pick(layer, (cycle || "release") as Cycle, version || null);
      }}
      aria-label={t(NAMES[layer].label)}
      sx={{ minWidth: 132 }}
    >
      {/* Whichever is newest, which is the one thing that can be asked for
          without having been told which releases exist. */}
      <MenuItem value="">{t("update.newest")}</MenuItem>
      {cycles.flatMap((cycle) => [
        // A heading only where there is more than one cycle to tell apart:
        // one list under one name is a name that says nothing.
        ...(cycles.length > 1
          ? [<ListSubheader key={cycle}>{t(`update.cycle.${cycle}`)}</ListSubheader>]
          : []),
        ...at.versions[cycle].map((version) => (
          <MenuItem key={`${cycle}:${version}`} value={`${cycle}:${version}`}>
            {version}
          </MenuItem>
        )),
      ])}
    </Select>
  );
}

/**
 * The three rows, and the rule above them.
 *
 * The pages the window is drawn out of are a download of about a megabyte and a
 * reload. The application layer beside the program is a download of a few and
 * nothing at all — no reload, no restart, and every terminal in the window goes
 * on running. The program itself is a large download and a restart that ends
 * every one of them. They were always separate mechanisms — see
 * `src-tauri/src/front`, `src-tauri/src/app_layer` and `src-tauri/src/update` —
 * and this is the three of them said out loud, because the last cost is one
 * nobody should pay by having pressed one of the others.
 *
 * A row is drawn wherever the backend says there is one and left at its ending
 * where this copy cannot take it: a `.deb` and an `.rpm` are copies whose
 * program belongs to a package manager, and being told so is worth more than a
 * row that is not there. Where no layer can be replaced at all there are no
 * rows, and the rule above them belongs to them rather than to the page.
 */
export function UpdateSection() {
  const at = useUpdate();

  useEffect(() => {
    void askStanding();
  }, []);

  const rungs = LAYERS.map((layer) => rungOf(at, layer)).filter((rung) => rung !== null);
  if (rungs.length === 0 || !rungs.some((rung) => rung.can)) return null;

  return (
    <>
      <Divider />
      {rungs.map((rung) => (
        <LayerRow key={rung.layer} at={at} rung={rung} />
      ))}
    </>
  );
}

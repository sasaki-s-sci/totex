/**
 * Replacing the app with a newer release, a half at a time.
 */

import { Divider, MenuItem, Select } from "@mui/material";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";

import {
  askStanding,
  type Half,
  pick,
  reload,
  restart,
  stageOf,
  take,
  type UpdateStage,
  useUpdate,
  wanted,
} from "../../lib/update";
import { UpdateMark } from "../marks";
import { PageButton, Row } from "./Row";

/**
 * What each state of a row is, which is also what a press of it does.
 *
 * Two maps rather than one, because the two halves cost different things and
 * end in different words. Each carries a word for the ending the other reaches
 * — a reload never finishes a program and a restart never finishes a page — so
 * that a row is a plain lookup rather than a lookup and a special case.
 */
const PAGES = {
  rest: "update.take",
  taking: "update.taking",
  current: "update.current",
  swapped: "update.reload",
  ready: "update.reload",
  held: "update.inProgram",
  failed: "update.failed",
} as const satisfies Record<UpdateStage, string>;

const PROGRAM = {
  rest: "update.take",
  // Named apart from the pages' word for the same state: this is eighty
  // megabytes and a ring that fills, and "downloading" is what that is.
  taking: "update.fetching",
  current: "update.current",
  swapped: "update.restart",
  ready: "update.restart",
  held: "update.held",
  failed: "update.failed",
} as const satisfies Record<UpdateStage, string>;

/**
 * The words one row draws itself with: one of the two maps above, kept as the
 * literal keys they are so that a name no locale carries does not compile.
 */
type Words = typeof PAGES | typeof PROGRAM;

/**
 * One half of a release, and the one press that brings it.
 *
 * The mark is kept here rather than replaced by a word, because it is the one
 * thing on the page saying what the words do not: a ring that turns while the
 * release page is being read, and fills as the download arrives.
 *
 * Red is kept for the two endings — a restart that takes every terminal with
 * it, and a press that did not work. A reload is neither: the program under the
 * window is the same program, and everything running in it goes on running.
 */
function HalfRow({
  half,
  label,
  hint,
  words,
  supported,
  stage,
  progress,
}: {
  half: Half;
  label: string;
  hint: string;
  words: Words;
  /** Whether this half can be replaced here at all — see `update.rs`. */
  supported: boolean;
  stage: UpdateStage;
  progress: number | null;
}) {
  const { t } = useTranslation();
  // A half this copy cannot have is drawn at its ending rather than left out:
  // being told the program belongs to a package manager is worth more than a
  // row that is not there.
  const at = supported ? stage : "held";

  return (
    <Row label={label} hint={hint}>
      <PageButton
        danger={at === "ready" || at === "failed"}
        disabled={at === "taking" || at === "held"}
        icon={<UpdateMark stage={at} progress={progress} />}
        onClick={() => {
          if (at === "ready") restart();
          else if (at === "swapped") reload();
          else void take(half);
        }}
      >
        {t(words[at])}
      </PageButton>
    </Row>
  );
}

/**
 * Replacing the app with another release of it, where that can work.
 *
 * Three rows: which release, and then each of the two halves that release comes
 * in. The pages the window is drawn out of are a download of about a megabyte
 * and a reload; the program under them is a large one and a restart that ends
 * every terminal in the window. They were always two mechanisms — see
 * `src-tauri/src/front` — and this is the two of them said out loud, because
 * the second cost is one nobody should pay by having pressed once.
 *
 * The release is named rather than implied. A window that can only ever be
 * carried forwards is a window somebody has to reinstall by hand the first time
 * a release turns out worse than the one before it, so the pull-down is every
 * release there is and the rows act on the one it is left on. Which releases
 * exist is asked for on a loop from the moment the window opens — see
 * `watchVersions` — so that the list is full when it is opened.
 *
 * Neither row is drawn where nothing could be replaced: a binary run out of
 * `target/` was never installed, so there is nothing a release page can do for
 * it. A `.deb` and an `.rpm` are drawn: the program in those belongs to a
 * package manager and is left to it, but the pages are the app's own and are
 * replaced the same way everywhere — which is the whole reason the two halves
 * are controlled apart.
 *
 * The rule above it belongs to it and not to the page: where there are no rows
 * there is nothing to divide.
 */
export function UpdateSection() {
  const { t } = useTranslation();
  const at = useUpdate();
  const { standing, versions } = at;

  useEffect(() => {
    void askStanding();
  }, []);

  if (!standing || (!standing.front && !standing.whole)) return null;

  // Nothing has answered with a list of releases yet, or nothing can: the rows
  // still work, and what they mean is whatever the release page says is newest.
  const release = wanted(at) ?? "";
  const taking = at.front.stage === "taking" || at.whole.stage === "taking";

  return (
    <>
      <Divider />
      <Row label={t("settings.update")}>
        <Select
          size="small"
          value={release}
          disabled={versions.length === 0 || taking}
          onChange={(event) => pick(event.target.value)}
          aria-label={t("settings.update")}
          sx={{ minWidth: 132 }}
        >
          {versions.length === 0 ? (
            <MenuItem value="">{t("update.newest")}</MenuItem>
          ) : (
            versions.map((version) => (
              <MenuItem key={version} value={version}>
                {version}
              </MenuItem>
            ))
          )}
        </Select>
      </Row>
      <HalfRow
        half="front"
        label={t("update.pages")}
        hint={t("update.drawn", { version: standing.drawn })}
        words={PAGES}
        supported={standing.front}
        stage={stageOf(at, "front")}
        progress={at.front.progress}
      />
      <HalfRow
        half="whole"
        label={t("update.program")}
        hint={t("update.running", { version: standing.running })}
        words={PROGRAM}
        supported={standing.whole}
        stage={stageOf(at, "whole")}
        progress={at.whole.progress}
      />
    </>
  );
}

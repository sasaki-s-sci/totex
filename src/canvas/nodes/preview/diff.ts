/**
 * What the file in a card has become since the commit under it.
 *
 * Two things are drawn from one answer: bars down the gutter of the reading,
 * which say which lines moved, and the patch itself in place of the reading,
 * which says what they were. Both are the same three colours the folder column
 * draws its rows in and a branch its rim — green for what arrived, amber for
 * what was rewritten, red for what has gone.
 */

import { type CSSProperties, useEffect, useState } from "react";
import { type DiffRun, type FileDiff, fileDiff } from "../../../folder/api";
import { changesIn, watchChanges } from "../../../folder/changes";
import { baseName, folderOf } from "../../../folder/format";

/** A file nothing has answered for: the one outside a repository, and every
 *  file for the moment before git has been asked. */
const NOTHING: FileDiff = { standing: "unknown", patch: "", truncated: false, runs: [] };

/**
 * What git says about one file, kept up to date while the card is drawn.
 *
 * git is not asked about the file at all until the folder it is in says the file
 * moved. That answer is already being read — the folder column asks about every
 * directory it has open, on a clock, and `changes` is where those answers are
 * kept — so a card joins that reading rather than starting one of its own, and a
 * file with nothing to show costs no git at all.
 *
 * `reading` is what the card is holding, and it is here to be waited on rather
 * than read: a card that has just written its file has changed what the patch
 * would say without changing what git says became of it, and the write is what
 * this catches. See `refreshChanges` on the other side of a save.
 */
export function useFileDiff(path: string | null, reading: string | null): FileDiff {
  const [diff, setDiff] = useState<FileDiff>(NOTHING);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the reading is waited on rather than read — a card that has just written its file is a patch that moved without git having anything new to say about the file
  useEffect(() => {
    // A card drawing a page of its file is not the card its patch belongs to:
    // the file it is a page of is the card beside it, and that one is asking.
    if (path === null) return;
    const folder = folderOf(path);
    if (!folder) return;
    const name = baseName(path);
    let alive = true;

    const read = () => {
      // Nothing became of it, as far as the folder it is in has been told. That
      // is the answer for most files, and it is an answer rather than a reason
      // to ask again.
      if (changesIn(folder).changed[name] === undefined) {
        setDiff(NOTHING);
        return;
      }
      void fileDiff(path)
        .then((answer) => {
          if (alive) setDiff(answer);
        })
        .catch(() => undefined);
    };

    read();
    const stop = watchChanges(folder, read);
    return () => {
      alive = false;
      stop();
    };
  }, [path, reading]);

  return diff;
}

/** Whether there is anything to show, which is what puts the diff on offer. */
export function changed(diff: FileDiff): boolean {
  return diff.standing === "changed" || diff.standing === "untracked";
}

/**
 * The runs the gutter is drawn from.
 *
 * git's own, except for a file it has never been told about: there is no patch
 * for one of those, and the whole of what the card is holding is what arrived.
 */
export function fileRuns(diff: FileDiff, lines: number): readonly DiffRun[] {
  if (diff.standing !== "untracked") return diff.runs;
  return lines > 0 ? [{ line: 1, lines, mark: "added" }] : [];
}

/**
 * The patch the card draws, which for a file git has never been told about is
 * the file itself: every line of it arrived.
 */
export function patchOf(diff: FileDiff, reading: string | null): string {
  if (diff.standing !== "untracked") return diff.patch;
  if (reading === null || reading === "") return "";
  const body = reading.endsWith("\n") ? reading.slice(0, -1) : reading;
  return body
    .split("\n")
    .map((line) => `+${line}`)
    .join("\n");
}

/** What one line of a patch is, which is the colour it is drawn behind. */
export type Tint = "added" | "deleted" | "hunk";

/** A run of patch lines that are all the one thing. */
export type TintRun = { from: number; lines: number; tint: Tint };

/**
 * The patch as runs of lines to be drawn behind rather than as lines to draw.
 *
 * The patch itself is one block of text, as every reading in a card is: a card
 * stands on a canvas whose frame is counted in elements, and a patch given an
 * element per line would put thousands of them there. What each line is is said
 * behind it instead, in as many bars as there are runs — which is a handful.
 */
export function tintRuns(patch: string): TintRun[] {
  const runs: TintRun[] = [];
  const lines = patch.split("\n");
  for (let at = 0; at < lines.length; at += 1) {
    const tint = tintOf(lines[at]);
    if (!tint) continue;
    // Carried on rather than started again, while the line above it was the
    // same kind of line: what is drawn is one bar for each stretch of them.
    const last = runs[runs.length - 1];
    if (last && last.tint === tint && last.from + last.lines === at) last.lines += 1;
    else runs.push({ from: at, lines: 1, tint });
  }
  return runs;
}

function tintOf(line: string): Tint | null {
  if (line.startsWith("+")) return "added";
  if (line.startsWith("-")) return "deleted";
  if (line.startsWith("@@ ")) return "hunk";
  return null;
}

/**
 * Where a run of the file stands in a reading, as the stylesheet counts it.
 *
 * Counted in the two lengths the reading is drawn by rather than measured: a
 * card's reading is one block of text with no element per line to ask, and the
 * size it is drawn at is the card's own — see `--reading-line` in
 * `canvas/reading.css`, which is what both this and the text are laid out by.
 * So a bar and the lines it is against agree at every size, without a single
 * measurement being taken.
 */
export function runBox(from: number, lines: number): CSSProperties {
  return {
    top: `calc(var(--reading-pad) + var(--reading-line) * ${Math.max(0, from)})`,
    height: lines > 0 ? `calc(var(--reading-line) * ${lines})` : undefined,
  };
}

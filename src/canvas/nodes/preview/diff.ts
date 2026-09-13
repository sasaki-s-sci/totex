import { type CSSProperties, useEffect, useState } from "react";
import { type DiffRun, type FileDiff, fileDiff } from "../../../folder/api";
import { changesIn, watchChanges } from "../../../folder/changes";
import { baseName, folderOf } from "../../../folder/format";

const NOTHING: FileDiff = { standing: "unknown", patch: "", truncated: false, runs: [] };

// git is asked only once the folder's change poll says the file moved; `reading` is a
// dependency so a save refreshes the patch.
export function useFileDiff(path: string | null, reading: string | null): FileDiff {
  const [diff, setDiff] = useState<FileDiff>(NOTHING);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the reading is waited on rather than read — a card that has just written its file is a patch that moved without git having anything new to say about the file
  useEffect(() => {
    if (path === null) return;
    const folder = folderOf(path);
    if (!folder) return;
    const name = baseName(path);
    let alive = true;

    const read = () => {
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

export function changed(diff: FileDiff): boolean {
  return diff.standing === "changed" || diff.standing === "untracked";
}

export function fileRuns(diff: FileDiff, lines: number): readonly DiffRun[] {
  if (diff.standing !== "untracked") return diff.runs;
  return lines > 0 ? [{ line: 1, lines, mark: "added" }] : [];
}

export function patchOf(diff: FileDiff, reading: string | null): string {
  if (diff.standing !== "untracked") return diff.patch;
  if (reading === null || reading === "") return "";
  const body = reading.endsWith("\n") ? reading.slice(0, -1) : reading;
  return body
    .split("\n")
    .map((line) => `+${line}`)
    .join("\n");
}

export type Tint = "added" | "deleted" | "hunk";

export type TintRun = { from: number; lines: number; tint: Tint };

// Runs rather than an element per line: the canvas frame is counted in elements.
export function tintRuns(patch: string): TintRun[] {
  const runs: TintRun[] = [];
  const lines = patch.split("\n");
  for (let at = 0; at < lines.length; at += 1) {
    const tint = tintOf(lines[at]);
    if (!tint) continue;
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

// In `--reading-line` units, so bars and text agree at every size with no measurement.
export function runBox(from: number, lines: number): CSSProperties {
  return {
    top: `calc(var(--reading-pad) + var(--reading-line) * ${Math.max(0, from)})`,
    height: lines > 0 ? `calc(var(--reading-line) * ${lines})` : undefined,
  };
}

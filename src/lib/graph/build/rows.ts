import type { Ask } from "../../ask";
import type { Report } from "../../mcp";
import type { Session } from "../../session";
import { FOLDER_ROW_WIDTH, markId, ROW_SOCKET, ROW_STACK_X, repoMark } from "../folders";
import type { PreparedRepository } from "../layout";
import {
  CLI_STEP,
  type Draw,
  FOLDER_GAP_Y,
  LANE_HEIGHT,
  type LineEnd,
  REPO_MARK_TRIM,
  rowPitch,
  rowReach,
} from "../model";
import type { Column } from "./column";
import { batched, offerNode, provisional, repositoryNode } from "./nodes";
import { holds, type LaidGroup } from "./parts";
import { merge, rowStack } from "./stack";

export type Row =
  | { entry: PreparedRepository; column: Column }
  | { entry: PreparedRepository; standing: Session[] };

export type Cursor = {
  cursor: number;

  /** The row above and its stack, while it is a mark row. */
  above: { line: number; marks: number } | null;

  /** How far down the last card reached. */
  floor: number;

  first: boolean;
};

export type Place = {
  id: string;

  /** The row the group hangs from; `null` for a repository standing on its own, which hangs from nothing. */
  from: LineEnd | null;

  x: number;
  open: ReadonlyMap<string, Session[]>;
  showing: string | null;
  asks: ReadonlyMap<string, Ask>;
  reports: ReadonlyMap<string, Report>;
  reaching: string | null;
  /** Air above a band, or above a mark under a band; see `airAbove`. */
  gap: number;
  draw: Draw;
};

// Marks run as a list; a band stands clear so two histories are told apart.
function airAbove(row: Row, at: Cursor, hung: boolean, gap: number): number {
  if (at.first) return hung ? FOLDER_GAP_Y : 0;
  return "column" in row || at.above === null ? gap : 0;
}

export function placeRow(row: Row, place: Place, drawn: LaidGroup, at: Cursor): Cursor {
  const air = airAbove(row, at, place.from !== null, place.gap);
  const next =
    "column" in row ? bandRow(row, place, drawn, at, air) : markRow(row, place, drawn, at, air);
  return { ...next, first: false };
}

function bandRow(
  row: Row & { column: Column },
  { id, from, x, reaching, draw }: Place,
  drawn: LaidGroup,
  at: Cursor,
  air: number,
): Cursor {
  const entry = row.entry;
  const top = at.cursor + air;
  const width = entry.style.width;
  const proposed = entry.repository.id === reaching;
  drawn.nodes.push(
    repositoryNode(entry, x, top, width, from === null, draw.before.get(entry.repository.id)),
  );
  drawn.nodes.push(...(proposed ? provisional(entry.nodes) : entry.nodes));
  drawn.nodes.push(...row.column.nodes);
  drawn.offers.push(...row.column.offers);
  drawn.members.push(entry.repository.id);

  // Lines stay in band coordinates: moving a repository is a new transform on the same paths.
  drawn.bands.push({
    id: entry.repository.id,
    x,
    y: top,
    width,
    height: entry.style.height,
    lines: entry.lines,
    runs: batched(row.column.lines),
    offers: batched(row.column.offerLines),
    provisional: proposed,
  });

  if (from) {
    const link = holds(id, from, entry.repository.id, {
      node: entry.repository.id,
      dx: entry.data.label.x,
      dy: entry.trunk,
    });
    drawn.links.push(link);

    // The one line that can be folded at; a line into a mark offers nothing.
    drawn.holds.push({ line: link, repository: entry.repository.id });
  }

  drawn.right = Math.max(drawn.right, x + Math.max(width, row.column.right));
  drawn.bottom = Math.max(drawn.bottom, top + Math.max(entry.style.height, row.column.bottom));
  return { ...at, cursor: top + entry.style.height, above: null };
}

function markRow(
  row: Row & { standing: Session[] },
  { id, from, x, open, showing, asks, reports, draw }: Place,
  drawn: LaidGroup,
  at: Cursor,
  air: number,
): Cursor {
  const entry = row.entry;
  const marks = row.standing.length;

  // Annotated: the row below reads it back off `above`, so inference would be circular.
  const line: number =
    at.above === null
      ? at.cursor + air + rowReach(marks)
      : at.above.line + rowPitch(at.above.marks, marks) + air;
  const top = line - LANE_HEIGHT / 2;

  const mark = markId(id, entry.repository);
  const work = workOf(entry);
  drawn.nodes.push(repoMark(id, entry.repository, { x, y: top }, work, from === null, draw));
  drawn.members.push(mark);
  if (from) {
    drawn.links.push(
      holds(id, from, entry.repository.id, { node: mark, dx: 0, dy: LANE_HEIGHT / 2 }),
    );
  }

  const stack = rowStack(
    row.standing,
    {
      open,
      socket: { node: mark, dx: ROW_SOCKET.x, dy: ROW_SOCKET.y },

      group: mark,
      lead: REPO_MARK_TRIM,
      at: { x: x + ROW_STACK_X, y: line },
      showing,
      asks,
      reports,
      floor: at.floor,
    },
    draw,
  );
  merge(stack, drawn);

  // A mark with nothing beside it offers its first terminal where a stack of one would stand.
  if (marks === 0) {
    drawn.offers.push(
      offerNode(
        `offer${mark}`,
        { kind: "open", repository: entry.repository, ...work },
        null,
        x + ROW_STACK_X,
        line - CLI_STEP / 2,
        draw,
      ),
    );
  }

  drawn.right = Math.max(drawn.right, x + FOLDER_ROW_WIDTH, stack.right);
  return { ...at, cursor: line + rowReach(marks), above: { line, marks }, floor: stack.floor };
}

// The default branch where it is drawn, else whichever branch has a worktree to stand in.
function workOf(entry: PreparedRepository): { branch: string; cwd: string | null } {
  const main = entry.repository.defaultBranch?.replace(/^refs\/heads\//, "");
  const run =
    entry.runs.find((candidate) => candidate.branch === main) ??
    entry.runs.find((candidate) => candidate.cwd !== null) ??
    entry.runs[0];
  return run
    ? { branch: run.branch, cwd: run.cwd }
    : { branch: main ?? entry.repository.name, cwd: entry.repository.path };
}

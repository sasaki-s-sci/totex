import type { Ask } from "../../ask";
import type { Report } from "../../mcp";
import type { Session } from "../../session";
import { markId, repoMark } from "../folders";
import type { PreparedRepository } from "../layout";
import {
  CHIP_STEP,
  type Draw,
  FOLDER_GAP_Y,
  LANE_HEIGHT,
  type LineEnd,
  REPO_GAP_Y,
  REPO_MARK_RING,
  REPO_MARK_WIDTH,
  RING_TRIM,
  rowPitch,
  rowReach,
  SESSION_WIDTH,
} from "../model";
import type { Column } from "./column";
import { batched, provisional, repositoryNode } from "./nodes";
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
  draw: Draw;
};

// Marks run as a list; a band stands clear so two histories are told apart.
function airAbove(row: Row, at: Cursor, hung: boolean): number {
  if (at.first) return hung ? FOLDER_GAP_Y : 0;
  return "column" in row || at.above === null ? REPO_GAP_Y : 0;
}

export function placeRow(row: Row, place: Place, drawn: LaidGroup, at: Cursor): Cursor {
  const air = airAbove(row, at, place.from !== null);
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
  drawn.nodes.push(repoMark(id, entry.repository, { x, y: top }, from === null, draw));
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
      socket: { node: mark, dx: REPO_MARK_WIDTH - REPO_MARK_RING, dy: LANE_HEIGHT / 2 },

      group: mark,
      lead: RING_TRIM,
      at: {
        x: x + REPO_MARK_WIDTH - REPO_MARK_RING + CHIP_STEP - SESSION_WIDTH / 2,
        y: line,
      },
      showing,
      asks,
      reports,
      floor: at.floor,
    },
    draw,
  );
  merge(stack, drawn);

  drawn.right = Math.max(drawn.right, x + REPO_MARK_WIDTH, stack.right);
  return { ...at, cursor: line + rowReach(marks), above: { line, marks }, floor: stack.floor };
}

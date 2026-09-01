/**
 * One row of a folder's column, placed against the row above it.
 *
 * The two shapes a row comes in — a repository opened out into a band, and one
 * folded into a single mark — differ in what they are measured by. A band is a
 * box whose height the layout has already settled; a mark is a line, and how
 * far it stands from the line above is a sum over both of their stacks.
 */

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

/**
 * One row of a folder's column, and what it has running in it.
 *
 * A band stacks its terminals on the branches it draws, so what it is running
 * is already inside it; a folded repository has one ring and everything working
 * in it stands beside that.
 */
export type Row =
  | { entry: PreparedRepository; column: Column }
  | { entry: PreparedRepository; standing: Session[] };

/** Where the column has got to, which is what the next row is placed against. */
export type Cursor = {
  /** How far down the group reaches so far, which the next row clears. */
  cursor: number;
  /** The line of the row above and what it is running, while there is one. */
  above: { line: number; marks: number } | null;
  /** How far down the last card reached, for the next row to stand clear of. */
  floor: number;
  /** Whether the next row is the first under the folder's own row. */
  first: boolean;
};

/** Everything a row is placed by that is the same for every row in the group. */
export type Place = {
  /** The folder's own node, which is what the rows hang off. */
  id: string;
  /** Where every line the folder draws leaves from. */
  from: LineEnd;
  /** The column's left edge. */
  x: number;
  open: ReadonlyMap<string, Session[]>;
  showing: string | null;
  asks: ReadonlyMap<string, Ask>;
  reports: ReadonlyMap<string, Report>;
  reaching: string | null;
  draw: Draw;
};

/**
 * The air above a row.
 *
 * A column of folded repositories is a list and runs one row straight after
 * another — a row apiece is already a row of air between two names. A band is a
 * repository opened out and stands clear of whatever it is between, so that the
 * eye can tell where one history stops and the next begins. And the first row
 * of the lot is set under the folder by the group's own inset.
 */
function airAbove(row: Row, at: Cursor): number {
  if (at.first) return FOLDER_GAP_Y;
  return "column" in row || at.above === null ? REPO_GAP_Y : 0;
}

/** Places one row, whichever of the two shapes it is. */
export function placeRow(row: Row, place: Place, drawn: LaidGroup, at: Cursor): Cursor {
  const air = airAbove(row, at);
  const next =
    "column" in row ? bandRow(row, place, drawn, at, air) : markRow(row, place, drawn, at, air);
  return { ...next, first: false };
}

/**
 * A repository opened out: a box rather than a line, holding its own stacks.
 * The layout has already spaced its branches for what is running in them, so
 * the room it takes is the room it says it takes.
 */
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
  drawn.nodes.push(repositoryNode(entry, x, top, width, draw.before.get(entry.repository.id)));
  drawn.nodes.push(...(proposed ? provisional(entry.nodes) : entry.nodes));
  drawn.nodes.push(...row.column.nodes);
  drawn.members.push(entry.repository.id);

  // The lines come back as the band laid them out, in its own coordinates: the
  // band carries where it stands, so moving a repository is a different
  // transform on the same paths rather than a redrawn repository.
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

  // At the line the name is set over, which is the line the band opens on: the
  // fold, or the first commit drawn. The same end as a folded repository's —
  // the left edge of the same column, one row further down — so opening a
  // repository moves what the line arrives at and never where it arrives.
  drawn.links.push(
    holds(id, from, entry.repository.id, {
      node: entry.repository.id,
      dx: entry.data.label.x,
      dy: entry.data.label.y + entry.data.label.height,
    }),
  );

  // A column deeper than the band it belongs to is what the canvas has to make
  // room for; the band itself is the history's own height. A question standing
  // beside a terminal reaches past the band either way.
  drawn.right = Math.max(drawn.right, x + Math.max(width, row.column.right));
  drawn.bottom = Math.max(drawn.bottom, top + Math.max(entry.style.height, row.column.bottom));
  return { ...at, cursor: top + entry.style.height, above: null };
}

/**
 * A repository folded into one mark. Everything working anywhere in it stands
 * beside its ring: its own checkout and every worktree cut from it end in the
 * same place, so folding moves where a terminal is drawn and never whether it
 * is drawn.
 */
function markRow(
  row: Row & { standing: Session[] },
  { id, from, x, open, showing, asks, reports, draw }: Place,
  drawn: LaidGroup,
  at: Cursor,
  air: number,
): Cursor {
  const entry = row.entry;
  const marks = row.standing.length;
  // A row under another row stands the pitch of the two of them below it; one
  // under a band stands clear of the band's own box. Annotated because the row
  // below reads it back off `above`, and a type worked out from that would be a
  // type worked out from itself.
  const line: number =
    at.above === null
      ? at.cursor + air + rowReach(marks)
      : at.above.line + rowPitch(at.above.marks, marks) + air;
  const top = line - LANE_HEIGHT / 2;

  const mark = markId(id, entry.repository);
  drawn.nodes.push(repoMark(id, entry.repository, { x, y: top }, draw));
  drawn.members.push(mark);
  drawn.links.push(
    holds(id, from, entry.repository.id, { node: mark, dx: 0, dy: LANE_HEIGHT / 2 }),
  );

  const stack = rowStack(
    row.standing,
    {
      open,
      socket: { node: mark, dx: REPO_MARK_WIDTH - REPO_MARK_RING, dy: LANE_HEIGHT / 2 },
      // The ring is the whole of what is drawn for this repository, so it is
      // also the one place everything working anywhere in it is standing.
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

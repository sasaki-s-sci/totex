/**
 * The pieces a folder's column is assembled from: what one laid-out group is,
 * and the two things every row in it needs.
 */

import type { Session } from "../../session";
import type { AppNode, Band, GraphLine, LineEnd } from "../model";
import { FOLDER_MARK, FOLDER_STROKE } from "../model";

/** One folder laid out, and everything the canvas needs to know about it. */
export type LaidGroup = {
  nodes: AppNode[];
  bands: Band[];
  /** Its own lines, in canvas coordinates: what it holds, and what is running. */
  links: GraphLine[];
  /** Everything that travels with the folder — see `Group`. */
  members: string[];
  /**
   * How far into its own slot the folder row had to be set.
   *
   * Nothing but a ring puts anything above or to the left of the row, and the
   * lines are drawn in one box that starts at the corner of the canvas: a mark
   * at nine o'clock would be off the edge of it. So the row is set in by
   * whatever its ring reaches back past it, and the group is read from there.
   */
  inset: { x: number; y: number };
  /** How far what is drawn for it reaches, cards and all. */
  right: number;
  bottom: number;
  /**
   * How tall the group is, which is the room the next folder is laid out after.
   *
   * The rows and nothing else. A question standing beside a terminal is several
   * rows deep and comes and goes with the asking, and a canvas that reflowed
   * every folder under it each time an agent spoke would be a canvas nobody
   * could read while anything was running.
   */
  height: number;
};

/**
 * How far short of a row a line into it stops.
 *
 * A hair, so that the line arrives at the row rather than under whatever is
 * standing at that end of it: the folder's own line stops just before the name
 * it is pointing at, and a terminal's just past the last of its row's buttons.
 */
export const REACH_TRIM = 4;

/** One line from a folder's mark to something it holds. */
export function holds(band: string, from: LineEnd, repository: string, to: LineEnd): GraphLine {
  return {
    id: `${band}holds${repository}`,
    from,
    to,
    curve: true,
    trim: REACH_TRIM,
    lead: FOLDER_MARK / 2,
    stroke: FOLDER_STROKE,
  };
}

/**
 * The terminals running in one directory, taken out of what is still going
 * spare.
 *
 * A terminal is drawn once. Which row draws it is settled by whichever asks
 * first, and the rows are asked in the order they are read down the canvas.
 */
export function take(
  open: ReadonlyMap<string, Session[]>,
  claimed: Set<string>,
  /** Every directory this row answers for, in the order they are stacked. */
  home: readonly string[],
): Session[] {
  const standing: Session[] = [];
  for (const place of home) {
    for (const session of open.get(place) ?? []) {
      if (claimed.has(session.id)) continue;
      claimed.add(session.id);
      standing.push(session);
    }
  }
  return standing;
}

/** One row's terminals, and what they cost the row they stand beside. */

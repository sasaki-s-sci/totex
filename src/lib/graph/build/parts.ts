import type { Session } from "../../session";
import type { AppNode, Band, GraphLine, Hold, LineEnd, OfferFlowNode } from "../model";
import { FOLDER_MARK, FOLDER_STROKE } from "../model";

export type LaidGroup = {
  nodes: AppNode[];
  offers: OfferFlowNode[];
  bands: Band[];

  links: GraphLine[];

  holds: Hold[];

  members: string[];

  /** How far the row's stack reaches above it; lines are drawn in one box from the canvas corner. */
  inset: { x: number; y: number };

  right: number;
  bottom: number;

  /** Rows only, not cards: a card must not reflow the folders below it. */
  height: number;
};

/** A hair short of the row, so the line arrives at it rather than under what stands there. */
export const REACH_TRIM = 4;

export function holds(band: string, from: LineEnd, repository: string, to: LineEnd): GraphLine {
  return {
    id: `${band}holds${repository}`,
    from,
    to,
    // History curves; containment turns a corner.
    shape: "elbow",
    trim: REACH_TRIM,
    lead: FOLDER_MARK / 2,
    stroke: FOLDER_STROKE,
  };
}

// A terminal is drawn once: the first row to ask keeps it.
export function take(
  open: ReadonlyMap<string, Session[]>,
  claimed: Set<string>,

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

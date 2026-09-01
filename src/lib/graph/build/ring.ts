/**
 * What is running in a folder that holds no repository at all, set round its
 * row rather than stacked off the end of it.
 */

import type { Ask } from "../../ask";
import type { Report } from "../../mcp";
import { ordinalOf, type Session } from "../../session";
import { ASK_GAP, ASK_STACK_GAP } from "../asking";
import type { Ring } from "../folders";
import { CLI_MARK, CLI_STROKE, type Draw, inBand, onStack } from "../model";
import { besideMark } from "./cards";
import { cliNode } from "./nodes";
import { REACH_TRIM } from "./parts";
import type { RowStack } from "./stack";

/**
 * The same terminals, set round the folder's own row instead of beside it.
 *
 * For the folder that holds no repository: see `ring` in `folderGroup`. The
 * places are the ring's — from three o'clock, clockwise — and what is done at
 * each of them is what the stack does at each of its own, so a terminal reads
 * and behaves exactly as it does anywhere else on the canvas. Only where it
 * stands has changed.
 *
 * Each line comes out of the row's edge on the way to its own mark rather than
 * out of one end of it, which is what keeps a line to something at nine o'clock
 * from being drawn across the name it belongs to.
 *
 * The cards, on the other hand, keep their column: they are set past the whole
 * ring rather than beside the mark that raised them, because a card is wider
 * than the row itself and one hung off a mark at eleven o'clock would be a card
 * over the folder. Past the ring is where the first one stands either way — a
 * ring of one reaches exactly as far as the stack it replaced.
 */
export function rowRing(
  standing: readonly Session[],
  where: {
    open: ReadonlyMap<string, Session[]>;
    /** The folder's own node, which is the row every line here leaves. */
    node: string;
    ring: Ring;
    /** The row's own corner, which the ring is measured from. */
    at: { x: number; y: number };
    showing: string | null;
    asks: ReadonlyMap<string, Ask>;
    reports: ReadonlyMap<string, Report>;
    floor: number;
  },
  draw: Draw,
): RowStack {
  const { open, node, ring, at, showing, asks, reports } = where;
  const drawn: RowStack = {
    nodes: [],
    lines: [],
    marks: standing.length,
    right: at.x + ring.right,
    bottom: at.y + ring.bottom,
    floor: where.floor,
  };

  /** The one column the cards stand in, clear of everything on the ring. */
  const column = at.x + ring.right + ASK_GAP;

  for (const [slot, session] of standing.entries()) {
    const spot = ring.spots[slot];
    if (!spot) continue;

    const id = `session${session.id}`;
    const x = at.x + spot.x;
    const y = at.y + spot.y;

    drawn.nodes.push(
      cliNode(
        id,
        {
          session,
          showing: session.id === showing,
          ordinal: ordinalOf(open.get(session.cwd) ?? [], session),
        },
        null,
        x,
        y,
        draw,
      ),
    );

    drawn.lines.push({
      id: `${id}run`,
      from: inBand(node, spot.socket.x, spot.socket.y),
      to: onStack(id),
      shape: "curve",
      // Half the glyph it arrives at, so the line stops beside the terminal
      // rather than being drawn across it.
      trim: CLI_MARK / 2,
      lead: REACH_TRIM,
      stroke: CLI_STROKE,
    });

    const card = besideMark(session, asks, reports, id, null, column, y, drawn.floor, draw);
    if (!card) continue;

    drawn.floor = card.at + card.height + ASK_STACK_GAP;
    drawn.nodes.push(card.node);
    drawn.lines.push(card.line);
    drawn.right = Math.max(drawn.right, column + card.width);
    drawn.bottom = Math.max(drawn.bottom, card.at + card.height);
  }

  return drawn;
}

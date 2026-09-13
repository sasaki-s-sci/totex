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

export function rowRing(
  standing: readonly Session[],
  where: {
    open: ReadonlyMap<string, Session[]>;

    node: string;
    ring: Ring;

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

  // Cards stand past the whole ring: one hung off a mark at eleven o'clock would cover the folder.
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

          group: node,
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

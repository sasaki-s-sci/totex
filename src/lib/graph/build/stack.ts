/**
 * What is running beside a row that is not a branch: a folder itself, or a
 * repository folded into a single mark.
 */

import type { Ask } from "../../ask";
import type { Report } from "../../mcp";
import { ordinalOf, type Session } from "../../session";
import { ASK_GAP, ASK_STACK_GAP } from "../asking";
import {
  type AppNode,
  CLI_MARK,
  CLI_STEP,
  CLI_STROKE,
  type Draw,
  type GraphLine,
  type LineEnd,
  onStack,
  SESSION_WIDTH,
  stackReach,
} from "../model";
import { besideMark } from "./cards";
import { cliNode } from "./nodes";
import type { LaidGroup } from "./parts";

export type RowStack = {
  nodes: AppNode[];
  /** The lines back to the row, in canvas coordinates. */
  lines: GraphLine[];
  /** How many are standing there, which is the room the row has to ask for. */
  marks: number;
  right: number;
  bottom: number;
  /** How far down the last card reached, for the next row to stand clear of. */
  floor: number;
};

/**
 * What is running in one directory, stacked beside the row that draws it.
 *
 * The same stack a branch carries, hung on a row that is not a branch: a folder
 * itself, or a repository folded into a single mark. Oldest first, a `CLI_STEP`
 * apart, and centred on the row's own line rather than trailing under it — a
 * row is one place, and everything running in it belongs to that place equally.
 *
 * The row is what makes the room for it: nothing under a folder's own row has
 * been spaced by a layout, so a stack of three pushes the repositories below it
 * down by exactly what it reaches. See `stackRoom`.
 */
export function rowStack(
  standing: readonly Session[],
  where: {
    open: ReadonlyMap<string, Session[]>;
    /** Where a line from one of these lands: the row's mark, or its far end. */
    socket: LineEnd;
    /** How far out from that end its line starts, which is half of any mark. */
    lead: number;
    /** The stack's own column, and the line of the row it hangs on. */
    at: { x: number; y: number };
    showing: string | null;
    asks: ReadonlyMap<string, Ask>;
    reports: ReadonlyMap<string, Report>;
    floor: number;
  },
  draw: Draw,
): RowStack {
  const { open, socket, lead, at, showing, asks, reports } = where;
  const drawn: RowStack = {
    nodes: [],
    lines: [],
    marks: standing.length,
    right: at.x,
    bottom: at.y,
    floor: where.floor,
  };
  if (standing.length === 0) return drawn;

  // Where the top of the stack goes: half of it above the row's own line and
  // half below, so it opens out either way as it grows.
  const head = at.y - stackReach(standing.length) - CLI_STEP / 2;

  for (const [slot, session] of standing.entries()) {
    const id = `session${session.id}`;
    const y = head + slot * CLI_STEP;

    drawn.nodes.push(
      cliNode(
        id,
        {
          session,
          showing: session.id === showing,
          ordinal: ordinalOf(open.get(session.cwd) ?? [], session),
        },
        null,
        at.x,
        y,
        draw,
      ),
    );

    drawn.lines.push({
      id: `${id}run`,
      from: socket,
      to: onStack(id),
      curve: true,
      // Half the glyph it arrives at, so the line stops beside the terminal
      // rather than being drawn across it.
      trim: CLI_MARK / 2,
      lead,
      stroke: CLI_STROKE,
    });

    drawn.right = Math.max(drawn.right, at.x + SESSION_WIDTH);
    drawn.bottom = Math.max(drawn.bottom, y + CLI_STEP);

    // And whatever it has standing beside it: the one thing out here that is
    // words rather than a mark.
    const x = at.x + SESSION_WIDTH + ASK_GAP;
    const card = besideMark(session, asks, reports, id, null, x, y, drawn.floor, draw);
    if (!card) continue;

    drawn.floor = card.at + card.height + ASK_STACK_GAP;
    drawn.nodes.push(card.node);
    drawn.lines.push(card.line);
    drawn.right = Math.max(drawn.right, x + card.width);
    drawn.bottom = Math.max(drawn.bottom, card.at + card.height);
  }

  return drawn;
}

/** One row's stack, folded into the group it was drawn for. */
export function merge(stack: RowStack, drawn: LaidGroup) {
  drawn.nodes.push(...stack.nodes);
  drawn.links.push(...stack.lines);
  // Every mark out here stands on the canvas in its own right, so every one of
  // them is carried by hand when the folder is.
  for (const node of stack.nodes) drawn.members.push(node.id);
  drawn.right = Math.max(drawn.right, stack.right);
  drawn.bottom = Math.max(drawn.bottom, stack.bottom);
}

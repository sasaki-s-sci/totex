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

  lines: GraphLine[];

  marks: number;
  right: number;
  bottom: number;

  floor: number;
};

export function rowStack(
  standing: readonly Session[],
  where: {
    open: ReadonlyMap<string, Session[]>;

    socket: LineEnd;

    group: string;

    lead: number;

    at: { x: number; y: number };
    showing: string | null;
    asks: ReadonlyMap<string, Ask>;
    reports: ReadonlyMap<string, Report>;
    floor: number;
  },
  draw: Draw,
): RowStack {
  const { open, socket, lead, at, showing, asks, reports, group } = where;
  const drawn: RowStack = {
    nodes: [],
    lines: [],
    marks: standing.length,
    right: at.x,
    bottom: at.y,
    floor: where.floor,
  };
  if (standing.length === 0) return drawn;

  // Half above the row's line and half below, so it opens out either way.
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
          group,
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
      shape: "curve",

      trim: CLI_MARK / 2,
      lead,
      stroke: CLI_STROKE,
    });

    drawn.right = Math.max(drawn.right, at.x + SESSION_WIDTH);
    drawn.bottom = Math.max(drawn.bottom, y + CLI_STEP);

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

export function merge(stack: RowStack, drawn: LaidGroup) {
  drawn.nodes.push(...stack.nodes);
  drawn.links.push(...stack.lines);

  // Every mark out here is carried by hand when the folder is.
  for (const node of stack.nodes) drawn.members.push(node.id);
  drawn.right = Math.max(drawn.right, stack.right);
  drawn.bottom = Math.max(drawn.bottom, stack.bottom);
}

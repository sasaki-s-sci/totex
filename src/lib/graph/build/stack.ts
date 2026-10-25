import type { Report } from "../../mcp";
import { ordinalOf, type Session } from "../../session";
import {
  type AppNode,
  CLI_STEP,
  CLI_STROKE,
  type Draw,
  type GraphLine,
  type LineEnd,
  onStack,
  SESSION_WIDTH,
} from "../model";
import { REPORT_GAP, REPORT_STACK_GAP } from "../reporting";
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
    reports: ReadonlyMap<string, Report>;
    floor: number;
  },
  draw: Draw,
): RowStack {
  const { open, socket, lead, at, showing, reports, group } = where;
  const drawn: RowStack = {
    nodes: [],
    lines: [],
    marks: standing.length,
    right: at.x,
    bottom: at.y,
    floor: where.floor,
  };
  if (standing.length === 0) return drawn;

  // Heights do not depend on where a card stands, so they are measured before any is placed.
  const heights = standing.map(
    (session) => besideMark(session, reports, null, 0, 0, -Infinity, draw)?.height ?? CLI_STEP,
  );
  const centres = centresOf(heights, at.y, where.floor);

  for (const [slot, session] of standing.entries()) {
    const id = `session${session.id}`;
    const centre = centres[slot];
    const x = at.x + SESSION_WIDTH + REPORT_GAP;
    const card = besideMark(session, reports, null, x, centre - CLI_STEP / 2, drawn.floor, draw);
    // Level with its card's centre, so the run line reaches the card without a peak.
    const stand = card ? card.at + card.height / 2 - CLI_STEP / 2 : centre - CLI_STEP / 2;

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
        stand,
        draw,
      ),
    );

    drawn.right = Math.max(drawn.right, at.x + SESSION_WIDTH);
    drawn.bottom = Math.max(drawn.bottom, stand + CLI_STEP);

    // One edge from the folder to the card, as the git graph draws a parent link; the terminal is only its label.
    if (!card) {
      drawn.lines.push({
        id: `${id}run`,
        from: socket,
        to: onStack(id),
        shape: "curve",
        trim: 0,
        lead,
        stroke: CLI_STROKE,
      });
      continue;
    }

    drawn.floor = card.at + card.height + REPORT_STACK_GAP;
    drawn.nodes.push(card.node);
    drawn.lines.push({
      id: `${id}run`,
      from: socket,
      to: { node: card.node.id, dx: 0, dy: card.height / 2 },
      shape: "curve",
      trim: 0,
      lead,
      stroke: CLI_STROKE,
      terminal: id,
    });
    drawn.right = Math.max(drawn.right, x + card.width);
    drawn.bottom = Math.max(drawn.bottom, card.at + card.height);
  }

  return drawn;
}

/**
 * Centres of cards stacked with the gap between them. An odd stack's middle card is on the line
 * the terminals stand from; an even stack's middle pair is split either side of it. Never above `floor`.
 */
function centresOf(heights: readonly number[], line: number, floor: number): number[] {
  const count = heights.length;
  const odd = count % 2 === 1;
  const anchor = odd ? (count - 1) / 2 : count / 2 - 1;
  const centres: number[] = [];
  if (odd) {
    centres[anchor] = line;
  } else {
    const apart = (heights[anchor] + heights[anchor + 1]) / 2 + REPORT_STACK_GAP;
    centres[anchor] = line - apart / 2;
    centres[anchor + 1] = line + apart / 2;
  }
  for (let index = anchor - 1; index >= 0; index--) {
    centres[index] =
      centres[index + 1] - (heights[index] + heights[index + 1]) / 2 - REPORT_STACK_GAP;
  }
  for (let index = odd ? anchor + 1 : anchor + 2; index < count; index++) {
    centres[index] =
      centres[index - 1] + (heights[index - 1] + heights[index]) / 2 + REPORT_STACK_GAP;
  }
  const shift = Math.max(0, floor - (centres[0] - heights[0] / 2));
  return centres.map((centre) => centre + shift);
}

export function merge(stack: RowStack, drawn: LaidGroup) {
  drawn.nodes.push(...stack.nodes);
  drawn.links.push(...stack.lines);

  // Every mark out here is carried by hand when the folder is.
  for (const node of stack.nodes) drawn.members.push(node.id);
  drawn.right = Math.max(drawn.right, stack.right);
  drawn.bottom = Math.max(drawn.bottom, stack.bottom);
}

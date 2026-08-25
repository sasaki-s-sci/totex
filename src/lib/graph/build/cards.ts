/**
 * The cards that stand beside a terminal: the question it is being asked, and
 * what it says it is working on.
 */

import type { Ask } from "../../ask";
import type { Report } from "../../mcp";
import type { Session } from "../../session";
import { ASK_WIDTH, ASK_Z, type AskFlowNode, type AskNodeData, askCard } from "../asking";
import { type AppNode, CLI_STEP, type Draw, type GraphLine } from "../model";
import { type ReportFlowNode, type ReportNodeData, reportCard } from "../reporting";
import { cardLine } from "./column";

/**
 * One question's card, handed back unchanged where it can be.
 *
 * The same holding-on every other node here does, and it matters more for this
 * one than for most: a question is redrawn whenever the terminal under it says
 * anything at all, and a card rebuilt each time would be a card whose buttons
 * were new objects under a pointer that was already on one of them.
 */
export function askNode(
  id: string,
  data: AskNodeData,
  band: string | null,
  x: number,
  y: number,
  draw: Draw,
): AskFlowNode {
  const held = draw.before.get(id);
  if (
    held?.type === "ask" &&
    held.data.session === data.session &&
    held.data.ask === data.ask &&
    (held.parentId ?? null) === band &&
    held.position.x === x &&
    held.position.y === y
  ) {
    return held;
  }

  return {
    id,
    type: "ask",
    ...(band === null ? null : { parentId: band }),
    position: { x, y },
    data,
    style: { width: data.card.width, height: data.card.height },
    zIndex: ASK_Z,
    draggable: false,
    selectable: false,
  };
}

/**
 * What a terminal has standing beside it, and where.
 *
 * Two things can be there and only ever one of them at a time: the question the
 * session has stopped to ask, and — where nothing is waiting — what it says it
 * is working on. The question wins, and not because it is newer. A question is
 * a turn nobody has taken, nothing else happens in that session until it is
 * answered, and what the agent said it was doing a moment before it stopped to
 * ask is the less useful of the two things it could be saying.
 *
 * `floor` is how far down the last card in this column reached. A card is
 * several times the height of the mark it belongs to, so each one is set beside
 * its own terminal wherever there is room and pushed down past the last one
 * where there is not: a card shoved down the canvas is still readable, and two
 * drawn over each other are not.
 */
export function besideMark(
  session: Session,
  asks: ReadonlyMap<string, Ask>,
  reports: ReadonlyMap<string, Report>,
  /** The terminal mark it belongs to, which its line comes out of. */
  mark: string,
  band: string | null,
  x: number,
  y: number,
  floor: number,
  draw: Draw,
): { node: AppNode; line: GraphLine; at: number; width: number; height: number } | null {
  /** Beside its own terminal, or under whatever was drawn last. */
  const place = (height: number) => Math.max(y + CLI_STEP / 2 - height / 2, floor);

  const asking = asks.get(session.id);
  if (asking) {
    const id = `ask${session.id}`;
    const card = askCard(asking);
    const at = place(card.height);
    return {
      node: askNode(id, { session, ask: asking, card }, band, x, at, draw),
      line: cardLine(id, mark, card.height),
      at,
      width: card.width,
      height: card.height,
    };
  }

  const said = reports.get(session.id);
  if (!said) return null;

  const id = `report${session.id}`;
  const card = reportCard(said);
  const at = place(card.height);
  return {
    node: reportNode(id, { session, report: said, card }, band, x, at, draw),
    line: cardLine(id, mark, card.height),
    at,
    width: ASK_WIDTH,
    height: card.height,
  };
}

/**
 * One report's card, handed back unchanged where it can be.
 *
 * The same holding-on as a question's, and for a gentler version of the same
 * reason: a report changes when the agent says something new rather than
 * whenever the terminal draws, but the graph around it is rebuilt for every
 * commit, every fold and every keystroke in a session — and a card rebuilt each
 * of those times is a card React Flow has to place again.
 */
export function reportNode(
  id: string,
  data: ReportNodeData,
  band: string | null,
  x: number,
  y: number,
  draw: Draw,
): ReportFlowNode {
  const held = draw.before.get(id);
  if (
    held?.type === "report" &&
    held.data.session === data.session &&
    held.data.report === data.report &&
    (held.parentId ?? null) === band &&
    held.position.x === x &&
    held.position.y === y
  ) {
    return held;
  }

  return {
    id,
    type: "report",
    ...(band === null ? null : { parentId: band }),
    position: { x, y },
    data,
    style: { width: ASK_WIDTH, height: data.card.height },
    zIndex: ASK_Z,
    draggable: false,
    selectable: false,
  };
}

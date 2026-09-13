import type { Ask } from "../../ask";
import type { Report } from "../../mcp";
import type { Session } from "../../session";
import { ASK_WIDTH, ASK_Z, type AskFlowNode, type AskNodeData, askCard } from "../asking";
import { type AppNode, CLI_STEP, type Draw, type GraphLine } from "../model";
import { type ReportFlowNode, type ReportNodeData, reportCard } from "../reporting";
import { cardLine } from "./column";

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

export function besideMark(
  session: Session,
  asks: ReadonlyMap<string, Ask>,
  reports: ReadonlyMap<string, Report>,

  mark: string,
  band: string | null,
  x: number,
  y: number,
  floor: number,
  draw: Draw,
): { node: AppNode; line: GraphLine; at: number; width: number; height: number } | null {
  // A card is taller than its mark: beside its own terminal if there is room, else below the last card.
  const place = (height: number) => Math.max(y + CLI_STEP / 2 - height / 2, floor);

  // A question wins over a report: nothing else happens in that session until it is answered.
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

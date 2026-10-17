import type { Report } from "../../mcp";
import type { Session } from "../../session";
import { type AppNode, CLI_STEP, type Draw, type GraphLine } from "../model";
import {
  REPORT_WIDTH,
  REPORT_Z,
  type ReportFlowNode,
  type ReportNodeData,
  reportCard,
} from "../reporting";
import { cardLine } from "./column";

export function besideMark(
  session: Session,
  reports: ReadonlyMap<string, Report>,

  mark: string,
  band: string | null,
  x: number,
  y: number,
  floor: number,
  draw: Draw,
): { node: AppNode; line: GraphLine; at: number; width: number; height: number } | null {
  const said = reports.get(session.id);
  if (!said) return null;

  const id = `report${session.id}`;
  const card = reportCard(said);
  // A card is taller than its mark: beside its own terminal if there is room, else below the last card.
  const at = Math.max(y + CLI_STEP / 2 - card.height / 2, floor);
  return {
    node: reportNode(id, { session, report: said, card }, band, x, at, draw),
    line: cardLine(id, mark, card.height),
    at,
    width: REPORT_WIDTH,
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
    style: { width: REPORT_WIDTH, height: data.card.height },
    zIndex: REPORT_Z,
    draggable: false,
    selectable: false,
  };
}

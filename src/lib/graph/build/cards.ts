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
import { clampTile, TILE, type TileFlowNode, type TileNodeData } from "../tiles";
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
  if (!said) return besideTile(session, mark, band, x, y, floor, draw);

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

// Sessions without a report share a compact card.
function besideTile(
  session: Session,
  mark: string,
  band: string | null,
  x: number,
  y: number,
  floor: number,
  draw: Draw,
): { node: AppNode; line: GraphLine; at: number; width: number; height: number } {
  const id = `tile${session.id}`;
  const units = clampTile(draw.tiles.get(session.id) ?? TILE.start);
  const height = TILE.height + (units - TILE.start) * draw.step;
  const at = Math.max(y + CLI_STEP / 2 - height / 2, floor);
  return {
    node: tileNode(id, { session, units, height }, band, x, at, draw),
    line: cardLine(id, mark, height),
    at,
    width: draw.cardWidth,
    height,
  };
}

export function tileNode(
  id: string,
  data: TileNodeData,
  band: string | null,
  x: number,
  y: number,
  draw: Draw,
): TileFlowNode {
  const held = draw.before.get(id);
  if (
    held?.type === "tile" &&
    held.data.session === data.session &&
    held.data.units === data.units &&
    held.data.height === data.height &&
    held.style?.width === draw.cardWidth &&
    (held.parentId ?? null) === band &&
    held.position.x === x &&
    held.position.y === y
  ) {
    return held;
  }

  return {
    id,
    type: "tile",
    ...(band === null ? null : { parentId: band }),
    position: { x, y },
    data,
    style: { width: draw.cardWidth, height: data.height },
    zIndex: REPORT_Z,
    draggable: false,
    selectable: false,
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

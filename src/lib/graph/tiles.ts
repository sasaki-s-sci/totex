import type { Node } from "@xyflow/react";

import type { Session } from "../session";

/**
 * Every plain terminal's tile is this many grid steps tall by default, and never shorter: a tile is
 * fixed at its default length, and only expands from it.
 */
export const TILE = { start: 3, most: 12 } as const;

export const TILE_WIDTH = 200;

export type TileNodeData = {
  session: Session;
  /** Grid steps tall, clamped to `TILE`. */
  units: number;
  /** Canvas units: `units` times the grid step. */
  height: number;
};

export type TileFlowNode = Node<TileNodeData, "tile">;

export function clampTile(units: number): number {
  return Math.min(TILE.most, Math.max(TILE.start, Math.round(units)));
}

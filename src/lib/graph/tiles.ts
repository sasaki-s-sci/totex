import type { Node } from "@xyflow/react";

import type { Session } from "../session";

/** Two 12px rows, a 2px gap, 4px padding and 2px border; extra units add grid steps. */
export const TILE = { start: 2, most: 12, height: 32 } as const;

export const TILE_WIDTH = 220;

export type TileNodeData = {
  session: Session;
  /** Resize units, clamped to `TILE`. */
  units: number;
  /** Two text rows plus a grid step for each unit above `TILE.start`. */
  height: number;
};

export type TileFlowNode = Node<TileNodeData, "tile">;

export function clampTile(units: number): number {
  return Math.min(TILE.most, Math.max(TILE.start, Math.round(units)));
}

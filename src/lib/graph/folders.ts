import type { Repository } from "../../types/git";
import type { GraphedKind } from "../graphed";
import {
  CELL_STYLE,
  CHIP_STEP,
  CLI_STEP,
  type Draw,
  FOLDER_INSET,
  type FolderFlowNode,
  type FolderNodeData,
  LANE_HEIGHT,
  NAME_HEIGHT,
  REPO_MARK_WIDTH,
  type RepoMarkFlowNode,
  SESSION_WIDTH,
} from "./model";

const TOOLS_WIDTH = 40;

export const FOLDER_MARK_X = 0;
const TOOLS_X = FOLDER_INSET;
export const FOLDER_ROW_WIDTH = TOOLS_X + TOOLS_WIDTH;

/** The drag handle class React Flow is pointed at; the row must draw it. */
export const GRIP = "folder__grip";

// Distinct from a repository's id: a folder opened on one would otherwise be
// two meanings under one node.
export function folderId(root: string): string {
  return `folder${root}`;
}

/** A folder holding one repository opens it by default; several start folded. */
export function isOpen(
  opened: ReadonlyMap<string, boolean>,
  repository: string,
  held: number,
): boolean {
  return opened.get(repository) ?? held <= 1;
}

export function folderRow(
  root: string,
  name: string,
  kind: GraphedKind,
  open: boolean,
  at: { x: number; y: number },
  draw: Draw,
): FolderFlowNode {
  const data: FolderNodeData = {
    kind,
    root,
    name,
    label: { x: FOLDER_MARK_X, y: 0, width: FOLDER_ROW_WIDTH, height: NAME_HEIGHT },
    open,
    mark: FOLDER_MARK_X,
    tools: TOOLS_X,
  };

  const id = folderId(root);
  const held = draw.before.get(id);
  if (
    held?.type === "folder" &&
    held.position.x === at.x &&
    held.position.y === at.y &&
    same(held.data, data)
  ) {
    return held;
  }

  return {
    id,
    type: "folder",
    position: { x: at.x, y: at.y },
    data,
    // Dragged by the mark only: the name beside it is a toggle.
    draggable: true,
    dragHandle: `.${GRIP}`,
    selectable: false,
    style: { width: FOLDER_ROW_WIDTH, height: LANE_HEIGHT, pointerEvents: "none" },
  };
}

// Placed on the canvas, not inside the folder row, so a folded repository
// stands exactly where its band would.
export function repoMark(
  band: string,
  repository: Repository,
  at: { x: number; y: number },
  draw: Draw,
): RepoMarkFlowNode {
  const id = markId(band, repository);
  const held = draw.before.get(id);
  if (
    held?.type === "repo-mark" &&
    held.data.repository === repository &&
    held.position.x === at.x &&
    held.position.y === at.y
  ) {
    return held;
  }

  return {
    id,
    type: "repo-mark",
    position: { x: at.x, y: at.y },
    data: { repository },
    style: { ...CELL_STYLE, width: REPO_MARK_WIDTH },
    draggable: false,
    selectable: false,
  };
}

export function markId(band: string, repository: Repository): string {
  return `${band}mark${repository.id}`;
}

export type RingSpot = {
  x: number;
  y: number;
  /** Where on the row's edge the line to this spot leaves. */
  socket: { x: number; y: number };
};

export type Ring = {
  spots: readonly RingSpot[];
  left: number;
  top: number;
  right: number;
  bottom: number;
};

const RING_SLOTS = 8;
const RING_STEP = CHIP_STEP;

// Terminals of a folder with no repository sit on an ellipse round the row,
// eight per turn at fixed angles so an arrival never moves the others.
export function ringAround(count: number): Ring {
  const cx = FOLDER_ROW_WIDTH / 2;
  const cy = LANE_HEIGHT / 2;

  const spots: RingSpot[] = [];
  const box = { left: 0, top: 0, right: FOLDER_ROW_WIDTH, bottom: LANE_HEIGHT };

  for (let slot = 0; slot < count; slot++) {
    const turn = Math.floor(slot / RING_SLOTS) + 1;
    const angle = ((slot % RING_SLOTS) * 2 * Math.PI) / RING_SLOTS;
    const along = Math.cos(angle);
    const down = Math.sin(angle);

    const x = Math.round(cx + (cx + RING_STEP * turn) * along - SESSION_WIDTH / 2);
    const y = Math.round(cy + (cy + RING_STEP * turn) * down - CLI_STEP / 2);

    // The line starts where the ray crosses the row's edge, not at its middle.
    const edge = Math.min(Math.abs(cx / along), Math.abs(cy / down));

    spots.push({ x, y, socket: { x: cx + edge * along, y: cy + edge * down } });

    box.left = Math.min(box.left, x);
    box.top = Math.min(box.top, y);
    box.right = Math.max(box.right, x + SESSION_WIDTH);
    box.bottom = Math.max(box.bottom, y + CLI_STEP);
  }

  return { spots, ...box };
}

function same(held: FolderNodeData, next: FolderNodeData): boolean {
  return (
    held.kind === next.kind &&
    held.root === next.root &&
    held.name === next.name &&
    held.open === next.open &&
    held.tools === next.tools
  );
}

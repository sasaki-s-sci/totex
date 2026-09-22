import type { Repository } from "../../types/git";
import type { GraphedKind } from "../graphed";
import {
  CHIP_STEP,
  type Draw,
  FOLDER_MARK,
  type FolderFlowNode,
  type FolderNodeData,
  HEADING_WIDTH,
  LANE_HEIGHT,
  type RepoMarkData,
  type RepoMarkFlowNode,
  SESSION_WIDTH,
} from "./model";

/** The name stands ahead of the mark on its line, in the same columns a band's heading takes. */
export const FOLDER_MARK_X = HEADING_WIDTH;
/** Row-relative box of the name, ending a little short of the mark. */
export const ROW_NAME = { x: 0, width: FOLDER_MARK_X - 4 } as const;
export const FOLDER_ROW_WIDTH = FOLDER_MARK_X + 40;

/** Row-relative middle of the mark: where a row's lines leave, as a branch's leave its ring. */
export const ROW_SOCKET = { x: FOLDER_MARK_X + FOLDER_MARK / 2, y: LANE_HEIGHT / 2 };
/** Row-relative left edge of a row's stack, as far from the mark as a branch's is from its ring. */
export const ROW_STACK_X = ROW_SOCKET.x + CHIP_STEP - SESSION_WIDTH / 2;

/** The drag handle class React Flow is pointed at; the row must draw it. */
export const GRIP = "folder__grip";

// Distinct from a repository's id: a folder opened on one would otherwise be
// two meanings under one node.
export function folderId(root: string): string {
  return `folder${root}`;
}

/**
 * What a group is moved and kept by. One directory can stand twice, as a folder and as a
 * repository, and each is dragged on its own.
 */
export function groupKey({ kind, root }: { kind: GraphedKind; root: string }): string {
  return kind === "folder" ? root : `repository ${root}`;
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
    label: { x: ROW_NAME.x, y: 0, width: ROW_NAME.width, height: LANE_HEIGHT },
    open,
    mark: FOLDER_MARK_X,
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
  /** Where the mark's own terminal opens. */
  work: RepoMarkData["work"],
  /** Standing on its own, the mark is what its group is moved by. */
  grip: boolean,
  draw: Draw,
): RepoMarkFlowNode {
  const id = markId(band, repository);
  const held = draw.before.get(id);
  if (
    held?.type === "repo-mark" &&
    held.draggable === grip &&
    held.data.repository === repository &&
    held.data.work.branch === work.branch &&
    held.data.work.cwd === work.cwd &&
    held.position.x === at.x &&
    held.position.y === at.y
  ) {
    return held;
  }

  return {
    id,
    type: "repo-mark",
    position: { x: at.x, y: at.y },
    data: { repository, work },
    style: { width: FOLDER_ROW_WIDTH, height: LANE_HEIGHT, pointerEvents: "none" },
    draggable: grip,
    ...(grip ? { dragHandle: `.${GRIP}` } : null),
    selectable: false,
  };
}

export function markId(band: string, repository: Repository): string {
  return `${band}mark${repository.id}`;
}

function same(held: FolderNodeData, next: FolderNodeData): boolean {
  return (
    held.kind === next.kind &&
    held.root === next.root &&
    held.name === next.name &&
    held.open === next.open
  );
}

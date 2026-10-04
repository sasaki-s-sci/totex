import type { Repository } from "../../types/git";
import type { GraphedKind } from "../graphed";
import {
  CHIP_STEP,
  CLI_MARK,
  type Draw,
  FOLDER_MARK,
  type FolderFlowNode,
  type FolderNodeData,
  HEADING_WIDTH,
  LANE_HEIGHT,
  type RepoMarkData,
  type RepoMarkFlowNode,
  SESSION_WIDTH,
  stackReach,
} from "./model";

/** The name stands ahead of the mark on its line, in the same columns a band's heading takes. */
export const FOLDER_MARK_X = HEADING_WIDTH;
export const FOLDER_ROW_WIDTH = FOLDER_MARK_X + 40;

/** Row-relative middle of the mark: where a row's lines leave, as a branch's leave its ring. */
export const ROW_SOCKET = { x: FOLDER_MARK_X + FOLDER_MARK / 2, y: LANE_HEIGHT / 2 };
/** Row-relative left edge of a row's stack, as far from the mark as a branch's is from its ring. */
export const ROW_STACK_X = ROW_SOCKET.x + CHIP_STEP - SESSION_WIDTH / 2;

/** The name's box over a row's stack: as tall as one line of it, and free to run on to the right. */
export const NAME_ABOVE = { width: 240, height: 18 } as const;

/**
 * Row-relative box of the name, standing on the top of the row's stack of `marks` terminals; with
 * none, on the offer, which stands where a stack of one would. `stack` is the row-relative left
 * edge of that stack, which lining the terminals up can move off the mark.
 */
export function nameAbove(marks: number, stack = ROW_STACK_X): RowLabel {
  // A terminal's glyph stands in the middle of its slot: the name comes down to the glyph's top.
  const top = ROW_SOCKET.y - stackReach(Math.max(1, marks)) - CLI_MARK / 2;
  return { x: stack, y: top - NAME_ABOVE.height, ...NAME_ABOVE };
}

export type RowLabel = { x: number; y: number; width: number; height: number };

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
  /** Terminals standing beside the row: the name stands on top of them. */
  marks: number,
  at: { x: number; y: number },
  draw: Draw,
): FolderFlowNode {
  const data: FolderNodeData = {
    kind,
    root,
    name,
    label: nameAbove(marks),
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
  /** Terminals standing beside the mark: the name stands on top of them. */
  marks: number,
  /** Row-relative left edge of those terminals, where the name stands. */
  stack: number,
  at: { x: number; y: number },
  /** Where the mark's own terminal opens. */
  work: RepoMarkData["work"],
  /** Standing on its own, the mark is what its group is moved by. */
  grip: boolean,
  draw: Draw,
): RepoMarkFlowNode {
  const id = markId(band, repository);
  const label = nameAbove(marks, stack);
  const held = draw.before.get(id);
  if (
    held?.type === "repo-mark" &&
    held.draggable === grip &&
    held.data.repository === repository &&
    held.data.work.branch === work.branch &&
    held.data.work.cwd === work.cwd &&
    held.data.label.x === label.x &&
    held.data.label.y === label.y &&
    held.position.x === at.x &&
    held.position.y === at.y
  ) {
    return held;
  }

  return {
    id,
    type: "repo-mark",
    position: { x: at.x, y: at.y },
    data: { repository, work, label },
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
    held.open === next.open &&
    held.label.y === next.label.y
  );
}

import type { Repository } from "../../types/git";
import {
  CELL_STYLE,
  CHIP_STEP,
  CLI_STEP,
  COLUMN_WIDTH,
  type Draw,
  FOLDER_MARK,
  type FolderFlowNode,
  type FolderNodeData,
  LANE_HEIGHT,
  NAME_COLUMN,
  REPO_MARK_WIDTH,
  type RepoMarkFlowNode,
  SESSION_WIDTH,
} from "./model";

/**
 * A folder drawn as the head of a column: its name, its own mark, and a line out
 * of that mark to every repository it holds.
 *
 * Reading the group is reading down a column: a repository per row, every one
 * joined back to the folder's mark, and never one to be found somewhere else. A
 * repository in that column is either folded into a single mark or opened out
 * into a band, and it stands in the same place either way — which is what makes
 * folding cheap. The row is a place as well as a heading: its own directory can
 * hold a terminal, and its mark is what the whole group is dragged by.
 */

/** How wide the row's own button is, which is what the row has to hold. */
const TOOLS_WIDTH = 40;

/** Where the folder's own mark stands: at the head of its row, before the name.
 *  Every line down to a repository leaves from here, and leaving from the left
 *  of the name gives those lines room to be a fan. */
export const FOLDER_MARK_X = 0;
/** The name, in what is left of the column the mark leads. */
const LABEL_X = FOLDER_MARK_X + FOLDER_MARK;
/**
 * Where the row's own button stands: at the column the repositories under it
 * begin at, so the row ends where their names do.
 */
const TOOLS_X = NAME_COLUMN * COLUMN_WIDTH;
/** How wide the row is: what it holds, and nothing beyond it. */
export const FOLDER_ROW_WIDTH = TOOLS_X + TOOLS_WIDTH;

/** The class on the folder's mark, which is what the row is dragged by: a
 *  contract between React Flow's selector and the element the row draws. */
export const GRIP = "folder__grip";

/** The row's node id, distinct from a repository's: a folder opened directly on
 *  one would otherwise be two meanings under a single node. */
export function folderId(root: string): string {
  return `folder${root}`;
}

/** Whether a repository is opened out into a band. A folder holding one is
 *  opened by default; one holding several starts folded. */
export function isOpen(
  opened: ReadonlyMap<string, boolean>,
  repository: string,
  held: number,
): boolean {
  return opened.get(repository) ?? held <= 1;
}

/** The folder's own row. `at` is where the group stands on the canvas, which is
 *  this row's position: everything else is placed against it. */
export function folderRow(
  root: string,
  name: string,
  /** Whether every repository in it is opened out, which the name toggles. */
  open: boolean,
  at: { x: number; y: number },
  draw: Draw,
): FolderFlowNode {
  const data: FolderNodeData = {
    root,
    name,
    label: { x: LABEL_X, y: 0, width: TOOLS_X - LABEL_X, height: LANE_HEIGHT },
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
    // The one node on the canvas the hand can move. What it is grabbed by is
    // the folder's own mark rather than the whole row: the name beside it opens
    // and shuts the group, and a name that also carried the group away would be
    // a button nobody could press without meaning to.
    draggable: true,
    dragHandle: `.${GRIP}`,
    selectable: false,
    // A row is a backdrop like a band; what can be pressed on it takes the
    // pointer back for itself.
    style: { width: FOLDER_ROW_WIDTH, height: LANE_HEIGHT, pointerEvents: "none" },
  };
}

/** One folded repository: its name and the ring standing for everything behind
 *  it. Placed on the canvas rather than inside the folder's row, so a folded
 *  repository stands exactly where its band would. */
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

/** What one folded repository's mark is called, on its folder's own row. */
export function markId(band: string, repository: Repository): string {
  return `${band}mark${repository.id}`;
}

/** Where one terminal stands on the ring, in the row's own coordinates, so the
 *  ring is worked out once and put wherever the row stands. */
export type RingSpot = {
  /** The corner of the terminal's own box, which is what a node is placed by. */
  x: number;
  y: number;
  /** The point on the row's edge the line to it comes out of. */
  socket: { x: number; y: number };
};

/** The ring, and the box everything on it comes to. */
export type Ring = {
  spots: readonly RingSpot[];
  /** The box the row and its ring take together, in the row's coordinates. */
  left: number;
  top: number;
  right: number;
  bottom: number;
};

/** How many terminals one turn of the ring holds before the next one out. */
const RING_SLOTS = 8;
/** How far the first ring clears the row by, and how far apart two rings are. */
const RING_STEP = CHIP_STEP;

/**
 * A folder's own terminals, set round the row rather than stacked beside it.
 *
 * For a folder holding no repository at all: nothing is under such a row, so
 * the room around it is all its own. They go on a ring from three o'clock,
 * eight to a turn at a fixed angle apiece — a terminal arriving must not
 * re-space the marks already standing — and the ninth starts the next ring out.
 * The ring is an ellipse because the row is.
 */
export function ringAround(count: number): Ring {
  const cx = FOLDER_ROW_WIDTH / 2;
  const cy = LANE_HEIGHT / 2;

  const spots: RingSpot[] = [];
  const box = { left: 0, top: 0, right: FOLDER_ROW_WIDTH, bottom: LANE_HEIGHT };

  for (let slot = 0; slot < count; slot++) {
    const turn = Math.floor(slot / RING_SLOTS) + 1;
    const angle = ((slot % RING_SLOTS) * 2 * Math.PI) / RING_SLOTS;
    // Down the page is where y grows, so an angle that grows runs clockwise —
    // which is what makes three o'clock the start rather than the end.
    const along = Math.cos(angle);
    const down = Math.sin(angle);

    const x = Math.round(cx + (cx + RING_STEP * turn) * along - SESSION_WIDTH / 2);
    const y = Math.round(cy + (cy + RING_STEP * turn) * down - CLI_STEP / 2);

    // Where the ray out to it crosses the row's own edge, which is where its
    // line starts: a line that left the middle would be drawn across the name
    // to reach anything standing on the far side of it.
    const edge = Math.min(Math.abs(cx / along), Math.abs(cy / down));

    spots.push({ x, y, socket: { x: cx + edge * along, y: cy + edge * down } });

    box.left = Math.min(box.left, x);
    box.top = Math.min(box.top, y);
    box.right = Math.max(box.right, x + SESSION_WIDTH);
    box.bottom = Math.max(box.bottom, y + CLI_STEP);
  }

  return { spots, ...box };
}

/** Whether the row would be drawn exactly as it already is. */
function same(held: FolderNodeData, next: FolderNodeData): boolean {
  return (
    held.root === next.root &&
    held.name === next.name &&
    held.open === next.open &&
    held.tools === next.tools
  );
}

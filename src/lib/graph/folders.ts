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
 * A folder drawn as the head of a column: its name, its own mark, and a line
 * out of that mark to every repository it holds.
 *
 * A folder is where work that spans several repositories is done — the reason
 * for putting one on the graph at all — and what the canvas has to say about it
 * is which repositories are in it and what is going on in each. So it is drawn
 * as one thing: a row, and under it a repository per row, every one of them
 * joined back to the folder's own mark. Reading the group is reading down a
 * column, and there is never a repository to be found somewhere other than
 * under the folder it came through.
 *
 * A repository in that column is either folded into a single mark or opened out
 * into a band of its own history, and it stands in the same place either way.
 * That is what makes folding cheap: what is drawn changes and nothing moves
 * sideways, and everything running in the repository stays in the column it was
 * already in.
 *
 * The row is a place as well as a heading. Its own directory is somewhere a
 * terminal can be opened, and the folder's mark is what the whole group is
 * dragged by — see `Group`.
 */

/** How wide the row's own button is, which is what the row has to hold. */
const TOOLS_WIDTH = 40;

/**
 * Where the folder's own mark stands: at the head of its row, before the name.
 *
 * The order the folder column in the sidebar reads in — the mark, then what it
 * is called — and here it earns that twice over. Every line down to a
 * repository leaves from this mark, and the repositories are set in by a whole
 * column, so leaving from the left of the name gives those lines the room to be
 * a fan rather than a single stroke down the edge of the rows.
 */
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

/**
 * The class on the folder's mark, which is what the row is dragged by.
 *
 * Named here rather than in the stylesheet's own words because it is a
 * contract: React Flow is told the selector, and the row draws the element.
 */
export const GRIP = "folder__grip";

/**
 * The row's node id.
 *
 * Distinct from a repository's, which is the path of its git directory: a
 * folder opened directly on a repository would otherwise be handed to React
 * Flow as one node under two meanings.
 */
export function folderId(root: string): string {
  return `folder${root}`;
}

/**
 * Whether a repository is opened out into a band of its own.
 *
 * A folder holding one repository is opened by default — folding it away would
 * hide the whole of what the folder is, and put a press between the window
 * opening and anything being on it. A folder holding several starts folded,
 * which is the arrangement the marks are for.
 */
export function isOpen(
  opened: ReadonlyMap<string, boolean>,
  repository: string,
  held: number,
): boolean {
  return opened.get(repository) ?? held <= 1;
}

/**
 * The folder's own row, at the head of its column.
 *
 * `at` is where the group stands on the canvas, which is this row's own
 * position: everything else in the group is placed against it, and moving the
 * folder is moving this node and taking the rest with it.
 */
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

/**
 * One folded repository: a row of its own, holding its name and the ring that
 * stands for everything behind it.
 *
 * Placed on the canvas rather than inside the folder's row, because a group is
 * a column of rows that are all placed the same way — the band of an opened
 * repository is a node of the canvas's, and a folded one has to be able to
 * stand exactly where it stood.
 */
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

/**
 * Where one terminal stands on the ring, and where its line leaves the row.
 *
 * Both in the row's own coordinates, so the ring is worked out once from the
 * shape of the row and then put wherever the row happens to stand.
 */
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
 * For the folder that holds no repository at all. There is nothing under such a
 * row and nothing beside it — the column that would push the canvas about is
 * empty — so what is running in it is the only thing the folder has to show,
 * and the room around the row is all its own. They are put on a ring from three
 * o'clock, clockwise: the first stands exactly where the stack used to start,
 * past the end of the row, and every one after it grows round the folder rather
 * than down away from it.
 *
 * Eight to a turn, at a fixed angle apiece rather than the circle split by how
 * many there are. A terminal opening is a terminal arriving, and one that
 * re-spaced every mark already standing would move the thing somebody was
 * reaching for. The ninth starts the next ring out, a `RING_STEP` further.
 *
 * The ring is an ellipse rather than a circle because the row is: it clears the
 * end of a long row on one axis and the height of it on the other, so the marks
 * hug what they belong to instead of standing off at the width of the name.
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

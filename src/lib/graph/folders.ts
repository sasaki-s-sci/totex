import type { Repository } from "../../types/git";
import {
  CELL_STYLE,
  COLUMN_WIDTH,
  type Draw,
  FOLDER_INSET,
  type FolderFlowNode,
  type FolderNodeData,
  inBand,
  LANE_HEIGHT,
  MIN_BAND_WIDTH,
  NAME_COLUMN,
  REPO_MARK_RING,
  REPO_MARK_WIDTH,
  type RepoMarkFlowNode,
} from "./model";

/**
 * A folder drawn as one line: its name, the repositories in it that are folded
 * away, and the button that opens a terminal in the folder itself.
 *
 * The whole point is that it stays one line however many repositories are in
 * it. A folder is where work that spans several of them is done — the reason
 * for opening one on the graph at all — and a dozen histories laid out at once
 * is a canvas nobody can find anything on. So a repository is a mark until it
 * is asked for, and what is asked for is a band underneath.
 *
 * The row is a place as well as a heading. Its own directory is somewhere a
 * terminal can be opened, and every worktree of every folded repository lands
 * on that repository's mark — so folding a repository away never loses what is
 * running in it, it only moves where the line ends.
 */

/** How wide the row's own button is, which is what the band has to hold. */
const TOOLS_WIDTH = 40;

/**
 * The row's node id.
 *
 * Distinct from a repository's, which is the path of its git directory: a
 * folder opened directly on a repository would otherwise be handed to React
 * Flow as one node under two meanings.
 */
function folderId(root: string): string {
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
 * The folder's row, at the top of its own group.
 *
 * `at` is where the group starts on the canvas; the marks are placed inside the
 * row and move with it. Everything the row can be aimed at — where a line into
 * the folder lands, and where a line into each folded repository lands — is
 * written into `draw` here, because this is the only place that knows where the
 * marks ended up.
 */
export function folderRow(
  root: string,
  name: string,
  /** The repositories in it that are folded away, in the folder's own order. */
  folded: readonly Repository[],
  /** Whether every repository in it is opened out, which the name toggles. */
  open: boolean,
  at: { x: number; y: number },
  draw: Draw,
): { nodes: (FolderFlowNode | RepoMarkFlowNode)[]; width: number } {
  const tools = FOLDER_INSET + folded.length * REPO_MARK_WIDTH;
  const width = Math.max(MIN_BAND_WIDTH, tools + TOOLS_WIDTH);
  const data: FolderNodeData = {
    root,
    name,
    label: { x: 0, y: 0, width: NAME_COLUMN * COLUMN_WIDTH, height: LANE_HEIGHT },
    open,
    tools,
  };

  const id = folderId(root);
  // The folder itself is a directory, so a terminal working in it has a place
  // on the canvas: the end of its own row, the way a worktree's line lands past
  // the end of its branch.
  draw.rows.set(root, inBand(id, tools, LANE_HEIGHT / 2));

  const held = draw.before.get(id);
  const node: FolderFlowNode =
    held?.type === "folder" &&
    held.position.x === at.x &&
    held.position.y === at.y &&
    held.style?.width === width &&
    same(held.data, data)
      ? held
      : {
          id,
          type: "folder",
          position: { x: at.x, y: at.y },
          data,
          draggable: false,
          selectable: false,
          // A row is a backdrop like a band; what can be pressed on it takes
          // the pointer back for itself.
          style: { width, height: LANE_HEIGHT, pointerEvents: "none" },
        };

  const nodes: (FolderFlowNode | RepoMarkFlowNode)[] = [node];
  for (const [index, repository] of folded.entries()) {
    const x = FOLDER_INSET + index * REPO_MARK_WIDTH;
    nodes.push(markNode(id, repository, x, draw));
    // Everything in there arrives at the mark: the repository's own checkout,
    // and every worktree cut from it. Its history is not on the canvas, so this
    // is the whole of where it is.
    const socket = inBand(id, x + REPO_MARK_WIDTH - REPO_MARK_RING, LANE_HEIGHT / 2);
    draw.rows.set(repository.path, socket);
    for (const worktree of repository.worktrees) draw.rows.set(worktree.path, socket);
  }

  return { nodes, width };
}

/** One folded repository, handed back unchanged where it can be. */
function markNode(band: string, repository: Repository, x: number, draw: Draw): RepoMarkFlowNode {
  const id = `${band}mark${repository.id}`;
  const held = draw.before.get(id);
  if (held?.type === "repo-mark" && held.data.repository === repository && held.position.x === x) {
    return held;
  }

  return {
    id,
    type: "repo-mark",
    parentId: band,
    position: { x, y: 0 },
    data: { repository },
    style: { ...CELL_STYLE, width: REPO_MARK_WIDTH },
    draggable: false,
    selectable: false,
  };
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

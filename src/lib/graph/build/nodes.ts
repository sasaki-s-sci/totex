/**
 * The nodes a band is drawn as, and the lines it hands back batched by how they
 * are stroked.
 */

import type { AskFlowNode } from "../asking";
import type { PreparedRepository } from "../layout";
import type {
  AppNode,
  CliFlowNode,
  CliNodeData,
  FolderFlowNode,
  GraphLine,
  GraphResult,
  RepoMarkFlowNode,
  RepositoryFlowNode,
  StrokeStyle,
} from "../model";
import { type Draw, STACK_STYLE } from "../model";
import type { ReportFlowNode } from "../reporting";

/**
 * The lines by how they are drawn, so that every line of one kind is a single
 * path.
 *
 * The same batching a band does with its history, for the same reason: a canvas
 * with a score of terminals on it should cost the engine a handful of elements.
 */
export function batched(lines: readonly GraphLine[]): GraphResult["reach"] {
  const batches = new Map<string, { key: string; stroke: StrokeStyle; parts: GraphLine[] }>();
  for (const line of lines) {
    const key = `${line.stroke.colour}|${line.stroke.width}|${line.stroke.opacity}|${line.stroke.dash ?? ""}`;
    const held = batches.get(key);
    if (held) {
      held.parts.push(line);
      continue;
    }
    batches.set(key, { key, stroke: line.stroke, parts: [line] });
  }
  return [...batches.values()];
}

/**
 * One terminal's mark, handed back unchanged where it can be.
 *
 * `band` is the repository whose branch it is standing under, and null for one
 * standing beside a folder's own row or a folded repository's mark — where it
 * goes when the canvas draws no branch for the directory it is running in. The
 * position is read against whichever of the two it is, so moving between them
 * is a node that changed rather than two nodes.
 *
 * Held on to across a rebuild: the graph is rebuilt whenever anything on it
 * moves, and a terminal that did not move is the same object it was — so its
 * mark is the one React Flow already has, rather than an equal copy it has to
 * take down and put up again.
 */
export function cliNode(
  id: string,
  data: CliNodeData,
  band: string | null,
  x: number,
  y: number,
  draw: Draw,
): CliFlowNode {
  const held = draw.before.get(id);
  if (
    held?.type === "cli" &&
    held.data.session === data.session &&
    held.data.showing === data.showing &&
    held.data.ordinal === data.ordinal &&
    (held.parentId ?? null) === band &&
    held.position.x === x &&
    held.position.y === y
  ) {
    return held;
  }

  return {
    id,
    type: "cli",
    ...(band === null ? null : { parentId: band }),
    position: { x, y },
    data,
    style: STACK_STYLE,
    draggable: false,
    selectable: false,
  };
}

/** The band itself: the backdrop a repository's own nodes are placed inside. */
export function repositoryNode(
  entry: PreparedRepository,
  x: number,
  y: number,
  width: number,
  before: AppNode | undefined,
): RepositoryFlowNode {
  if (
    before?.type === "repository" &&
    before.data === entry.data &&
    before.position.x === x &&
    before.position.y === y &&
    before.style?.width === width
  ) {
    return before;
  }

  return {
    id: entry.repository.id,
    type: "repository",
    position: { x, y },
    data: entry.data,
    draggable: false,
    selectable: false,
    // A band is a backdrop the width of a repository; taking the pointer would
    // mean no dragging the canvas anywhere history is drawn.
    style: { width, height: entry.style.height, pointerEvents: "none" },
  };
}

/** A node the build looks up rather than taking from a cached layout. */
export type Held =
  | RepositoryFlowNode
  | FolderFlowNode
  | RepoMarkFlowNode
  | CliFlowNode
  | AskFlowNode
  | ReportFlowNode;

/**
 * A band's own nodes, marked as being proposed rather than shown.
 *
 * Copied here rather than laid out that way, because the layout is cached per
 * repository and per depth and a pull passes through depths it may well come
 * back to — a cache holding a flag that belongs to one moment of one gesture
 * would hand it back long after the hand had gone.
 *
 * Only the branches carry it. A commit is drawn in the band's own SVG, which
 * is told about the pull once, as a class on the group the whole band is in.
 */
export function provisional(nodes: PreparedRepository["nodes"]): PreparedRepository["nodes"] {
  return nodes.map((node) =>
    node.type === "head" ? { ...node, data: { ...node.data, provisional: true } } : node,
  );
}

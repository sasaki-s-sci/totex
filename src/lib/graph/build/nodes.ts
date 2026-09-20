import type { AskFlowNode } from "../asking";
import { GRIP } from "../folders";
import type { PreparedRepository } from "../layout";
import type {
  AppNode,
  CliFlowNode,
  CliNodeData,
  FolderFlowNode,
  GraphLine,
  GraphResult,
  OfferData,
  OfferFlowNode,
  RepoMarkFlowNode,
  RepositoryFlowNode,
  StrokeStyle,
} from "../model";
import { CLI_STEP, type Draw, OFFER_STYLE, SESSION_WIDTH, STACK_STYLE } from "../model";
import type { ReportFlowNode } from "../reporting";

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

// The same object back when nothing moved, so React Flow keeps the node instead of replacing it.
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
    held.data.group === data.group &&
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

// Held still the same way: the offers are rebuilt with every graph and drawn on a key press.
export function offerNode(
  id: string,
  data: OfferData,
  band: string | null,
  x: number,
  y: number,
  draw: Draw,
): OfferFlowNode {
  const held = draw.offered.get(id);
  if (
    held &&
    held.data.kind === data.kind &&
    held.data.repository === data.repository &&
    (held.data.kind !== "open" ||
      (data.kind === "open" && held.data.branch === data.branch && held.data.cwd === data.cwd)) &&
    (held.parentId ?? null) === band &&
    held.position.x === x &&
    held.position.y === y
  ) {
    return held;
  }

  return {
    id,
    type: "offer",
    ...(band === null ? null : { parentId: band }),
    position: { x, y },
    data,
    // Given outright: an offer is not in the canvas's node state, so nothing would keep a measurement.
    initialWidth: SESSION_WIDTH,
    initialHeight: CLI_STEP,
    style: OFFER_STYLE,
    draggable: false,
    selectable: false,
  };
}

export function repositoryNode(
  entry: PreparedRepository,
  x: number,
  y: number,
  width: number,
  /** Standing on its own, the band is what its group is moved by. */
  grip: boolean,
  before: AppNode | undefined,
): RepositoryFlowNode {
  if (
    before?.type === "repository" &&
    before.draggable === grip &&
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
    draggable: grip,
    ...(grip ? { dragHandle: `.${GRIP}` } : null),
    selectable: false,

    // A band is a backdrop; taking the pointer would stop the canvas panning over history.
    style: { width, height: entry.style.height, pointerEvents: "none" },
  };
}

export type Held =
  | RepositoryFlowNode
  | FolderFlowNode
  | RepoMarkFlowNode
  | CliFlowNode
  | AskFlowNode
  | ReportFlowNode;

// Copied rather than laid out: layouts are cached per depth, and a pull revisits depths.
export function provisional(nodes: PreparedRepository["nodes"]): PreparedRepository["nodes"] {
  return nodes.map((node) =>
    node.type === "head" ? { ...node, data: { ...node.data, provisional: true } } : node,
  );
}

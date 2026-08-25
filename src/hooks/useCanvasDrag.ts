/**
 * The two things that can be picked up on the canvas: a branch dragged onto
 * another to merge it, and a whole folder carried somewhere else.
 */

import type { Edge, OnNodeDrag, ReactFlowInstance, XYPosition } from "@xyflow/react";
import { type RefObject, useCallback, useRef } from "react";
import { type AppNode, COLUMN_WIDTH, type GraphResult, HEAD_SIZE, LANE_HEIGHT } from "../lib/graph";
import type { Repository } from "../types/git";
import { useBranchDrag } from "./useBranchDrag";

export type DragCanvas = {
  graph: GraphResult;
  standing: RefObject<readonly AppNode[]>;
  host: RefObject<HTMLDivElement | null>;
  instance: RefObject<ReactFlowInstance<AppNode, Edge> | null>;
  setNodes: (update: (current: AppNode[]) => AppNode[]) => void;
  placeFolder: (root: string, at: XYPosition) => void;
  onMerge: (request: { repository: Repository; source: string; target: string }) => void;
};

export function useCanvasDrag({
  graph,
  standing,
  host,
  instance,
  setNodes,
  placeFolder,
  onMerge,
}: DragCanvas) {
  /**
   * Which head a screen point is inside, using graph geometry only.
   *
   * Asking the DOM where every ring stands forced a full layout at the start
   * of a merge drag. These are the same centres React Flow draws, transformed
   * back from the screen by the viewport it already owns.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the refs are the canvas's own and never change identity
  const headUnder = useCallback(
    (repository: Repository, source: string, x: number, y: number): string | null => {
      const point = instance.current?.screenToFlowPosition({ x, y });
      if (!point) return null;
      const band = standing.current.find(
        (node) => node.type === "repository" && node.id === repository.id,
      );
      if (!band) return null;

      let found: string | null = null;
      let nearest = Number.POSITIVE_INFINITY;
      for (const node of standing.current) {
        if (
          node.type !== "head" ||
          node.data.repository.id !== repository.id ||
          node.data.name === source ||
          // Nothing can be merged into a branch that is somewhere else: git
          // merges into a checked-out branch, and a remote-tracking ref is
          // neither. The head is drawn and pressable; it is simply never a
          // place a drag can land.
          node.data.kind === "remote"
        ) {
          continue;
        }
        const centre = {
          x: band.position.x + node.position.x + COLUMN_WIDTH / 2,
          y: band.position.y + node.position.y + LANE_HEIGHT / 2,
        };
        const away = Math.hypot(point.x - centre.x, point.y - centre.y);
        if (away > HEAD_SIZE / 2 || away >= nearest) continue;
        nearest = away;
        found = node.data.name;
      }
      return found;
    },
    [],
  );

  // Which branch is in hand and which one it is over goes onto the canvas
  // itself; nothing here is drawn from it, so nothing here has to re-render.
  const dragBranch = useBranchDrag(
    host,
    useCallback(
      (repository: Repository, source: string, target: string) => {
        onMerge({ repository, source, target });
      },
      [onMerge],
    ),
    headUnder,
  );

  /**
   * The group in hand, and where everything in it was standing when it was
   * picked up.
   *
   * A folder is one node and a group is everything under it, so the row moving
   * is only the start of the move: the marks, the bands and whatever is running
   * in any of them are all standing on the canvas in their own right and have
   * to be carried with it. Each of them is put at where it started plus how far
   * the row has come, rather than nudged by each frame's own delta — a hundred
   * frames of nudging is a hundred roundings, and the group would arrive
   * slightly out of shape.
   */
  const carried = useRef<{
    root: string;
    from: XYPosition;
    members: Map<string, XYPosition>;
  } | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the refs are the canvas's own and never change identity
  const takeGroup: OnNodeDrag<AppNode> = useCallback(
    (_event, node) => {
      if (node.type !== "folder") return;
      const group = graph.groups.get(node.data.root);
      if (!group) return;
      const wanted = new Set(group.members);
      const members = new Map<string, XYPosition>();
      for (const held of standing.current) {
        if (wanted.has(held.id)) members.set(held.id, held.position);
      }
      carried.current = { root: node.data.root, from: node.position, members };
    },
    [graph.groups],
  );

  const carryGroup: OnNodeDrag<AppNode> = useCallback(
    (_event, node) => {
      const held = carried.current;
      if (!held || node.type !== "folder") return;
      const dx = node.position.x - held.from.x;
      const dy = node.position.y - held.from.y;
      setNodes((current) =>
        current.map((one) => {
          const was = held.members.get(one.id);
          return was ? { ...one, position: { x: was.x + dx, y: was.y + dy } } : one;
        }),
      );
    },
    [setNodes],
  );

  /**
   * Where the group was let go, as how far it has come from its own slot.
   *
   * Held to the top left corner of the canvas, because the lines are drawn in
   * one box that starts there: a group carried above it would keep its marks
   * and lose everything joining them. Held to the group's own corner rather
   * than the canvas's — a folder with its terminals set round it carries marks
   * above and to the left of the row, and the corner is where they run out.
   */
  const dropGroup: OnNodeDrag<AppNode> = useCallback(
    (_event, node) => {
      const held = carried.current;
      carried.current = null;
      if (!held || node.type !== "folder") return;
      const group = graph.groups.get(held.root);
      if (!group) return;
      placeFolder(held.root, {
        x: Math.max(group.least.x, node.position.x) - group.at.x,
        y: Math.max(group.least.y, node.position.y) - group.at.y,
      });
    },
    [graph.groups, placeFolder],
  );

  return { dragBranch, takeGroup, carryGroup, dropGroup };
}

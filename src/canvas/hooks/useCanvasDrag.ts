import type { Edge, OnNodeDrag, ReactFlowInstance, XYPosition } from "@xyflow/react";
import { type RefObject, useCallback, useRef } from "react";
import {
  type AppNode,
  COMMIT_STEP,
  type GraphResult,
  gridMove,
  HEAD_SIZE,
  type Origin,
} from "../../lib/graph";
import type { Repository } from "../../types/git";
import { useBranchDrag } from "./useBranchDrag";

export type DragCanvas = {
  graph: GraphResult;
  standing: RefObject<readonly AppNode[]>;
  host: RefObject<HTMLDivElement | null>;
  instance: RefObject<ReactFlowInstance<AppNode, Edge> | null>;
  setNodes: (update: (current: AppNode[]) => AppNode[]) => void;
  placeFolder: (root: string, at: XYPosition) => void;
  onMerge: (request: { repository: Repository; source: string; target: string }) => void;
  onSync: (request: { repository: Repository; branch: string; origin: Origin }) => void;
};

export function useCanvasDrag({
  graph,
  standing,
  host,
  instance,
  setNodes,
  placeFolder,
  onMerge,
  onSync,
}: DragCanvas) {
  // biome-ignore lint/correctness/useExhaustiveDependencies: the refs are the canvas's own and never change identity
  const originOf = useCallback((repository: Repository, branch: string): Origin | null => {
    for (const node of standing.current) {
      if (node.type !== "head" || node.data.repository.id !== repository.id) continue;
      if (node.data.name === branch) return node.data.origin;
    }
    return null;
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the refs are the canvas's own and never change identity
  const headUnder = useCallback(
    (repository: Repository, source: string, x: number, y: number): string | null => {
      const point = instance.current?.screenToFlowPosition({ x, y });
      if (!point) return null;
      const band = standing.current.find(
        (node) => node.type === "repository" && node.id === repository.id,
      );
      if (!band) return null;

      const origin = originOf(repository, source)?.head ?? null;

      let found: string | null = null;
      let nearest = Number.POSITIVE_INFINITY;
      for (const node of standing.current) {
        if (
          node.type !== "head" ||
          node.data.repository.id !== repository.id ||
          node.data.name === source ||
          (node.data.kind === "remote" && node.data.name !== origin)
        ) {
          continue;
        }
        const centre = {
          x: band.position.x + node.position.x + COMMIT_STEP.x / 2,
          y: band.position.y + node.position.y + COMMIT_STEP.y / 2,
        };
        const away = Math.hypot(point.x - centre.x, point.y - centre.y);
        if (away > HEAD_SIZE / 2 || away >= nearest) continue;
        nearest = away;
        found = node.data.name;
      }
      return found;
    },
    [originOf],
  );

  // Only a checked-out branch can be merged into; landing on the branch's own remote end means a sync instead.
  const dragBranch = useBranchDrag(
    host,
    useCallback(
      (repository: Repository, source: string, target: string) => {
        const origin = originOf(repository, source);
        if (origin && target === origin.head) onSync({ repository, branch: source, origin });
        else onMerge({ repository, source, target });
      },
      [onMerge, onSync, originOf],
    ),
    headUnder,
    useCallback(
      (repository: Repository, branch: string) => originOf(repository, branch)?.head ?? null,
      [originOf],
    ),
  );

  const carried = useRef<{
    root: string;
    from: XYPosition;
    members: Map<string, XYPosition>;
  } | null>(null);

  // Each node lands at start + total offset rather than being nudged per frame, so rounding never accumulates.
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

  // Settled movement is whole columns and rows, so the group stays on the lattice.
  const dropGroup: OnNodeDrag<AppNode> = useCallback(
    (_event, node) => {
      const held = carried.current;
      carried.current = null;
      if (!held || node.type !== "folder") return;
      const group = graph.groups.get(held.root);
      if (!group) return;

      placeFolder(held.root, {
        x: gridMove(Math.max(group.least.x, node.position.x) - group.at.x, "x"),
        y: gridMove(Math.max(group.least.y, node.position.y) - group.at.y, "y"),
      });
    },
    [graph.groups, placeFolder],
  );

  return { dragBranch, takeGroup, carryGroup, dropGroup };
}

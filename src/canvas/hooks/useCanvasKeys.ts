import type { Edge, NodeMouseHandler, ReactFlowInstance } from "@xyflow/react";
import { type RefObject, useCallback, useState } from "react";
import type { AppNode, CommitFlowNode, GraphResult } from "../../lib/graph";
import { centreOf } from "../../lib/graphNav";
import type { Session } from "../../lib/session";
import type { WorkRequest } from "../graphActions";
import { useGraphKeys } from "./useGraphKeys";
import { useReadingKeys } from "./useReadingSize";

export type KeysCanvas = {
  graph: GraphResult;
  host: RefObject<HTMLDivElement | null>;
  instance: RefObject<ReactFlowInstance<AppNode, Edge> | null>;
  expand: (repository: string) => void;
  onSelect: (node: CommitFlowNode, at: { x: number; y: number }) => void;
  onCutBranch: (node: CommitFlowNode) => void;
  onOpenWork: (request: WorkRequest) => void;
  onShowSession: (session: Session) => void;
  onJumpSession: (session: Session) => void;
  onEndSession: (session: Session) => void;
};

export function useCanvasKeys({
  graph,
  host,
  instance,
  expand,
  onSelect,
  onCutBranch,
  onOpenWork,
  onShowSession,
  onJumpSession,
  onEndSession,
}: KeysCanvas) {
  // Commit marks live in the shared SVG, not in React Flow nodes, so their selection is kept here.
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  const handleCommitClick = useCallback(
    (node: CommitFlowNode, at: { x: number; y: number }) => {
      setSelectedCommit(node.id);
      onSelect(node, at);
    },
    [onSelect],
  );

  const handleNodeClick: NodeMouseHandler<AppNode> = () => setSelectedCommit(null);

  const land = useCallback((node: AppNode | null) => {
    setSelectedCommit(node?.type === "commit" ? node.id : null);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the refs are the canvas's own and never change identity
  const activate = useCallback(
    (node: AppNode) => {
      switch (node.type) {
        case "cli":
          if (node.data.session) onShowSession(node.data.session);
          return;
        case "ask":
          onShowSession(node.data.session);
          return;
        case "head":
          if (node.data.kind === "remote") return;
          onOpenWork({
            repository: node.data.repository,
            branch: node.data.name,
            cwd: node.data.cwd,
          });
          return;
        case "collapse":
          expand(node.data.repository.id);
          return;
        case "commit": {
          const at = instance.current?.flowToScreenPosition(centreOf(graph.nodes, node.id));
          if (at) onSelect(node, at);
          return;
        }
      }
    },
    [expand, graph.nodes, onOpenWork, onSelect, onShowSession],
  );

  // Not a toggle like activate: a number names a terminal and must land on it even if the panel already holds it.
  const jump = useCallback(
    (node: AppNode) => {
      if (node.type === "cli") onJumpSession(node.data.session);
    },
    [onJumpSession],
  );

  const finish = useCallback(
    (node: AppNode) => {
      if (node.type === "cli") onEndSession(node.data.session);
    },
    [onEndSession],
  );

  const cut = useCallback(
    (node: AppNode) => {
      if (node.type === "commit") onCutBranch(node);
    },
    [onCutBranch],
  );

  const { picked, jumps, reading } = useGraphKeys({
    nodes: graph.nodes,
    instance,
    host,
    activate,
    jump,
    end: finish,
    branch: cut,
    land,
    selected: selectedCommit,
  });

  useReadingKeys();

  return {
    picked,
    jumps,
    reading,
    selectedCommit,
    setSelectedCommit,
    handleCommitClick,
    handleNodeClick,
  };
}

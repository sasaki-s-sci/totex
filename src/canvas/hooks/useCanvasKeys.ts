import type { Edge, NodeMouseHandler, ReactFlowInstance } from "@xyflow/react";
import { type RefObject, useCallback, useState } from "react";
import type { AppNode, CommitFlowNode, GraphResult, OfferFlowNode } from "../../lib/graph";
import type { Session } from "../../lib/session";
import type { Repository } from "../../types/git";
import type { WorkRequest } from "../graphActions";
import { useGraphKeys } from "./useGraphKeys";
import { useReadingKeys } from "./useReadingSize";

export type KeysCanvas = {
  graph: GraphResult;
  host: RefObject<HTMLDivElement | null>;
  instance: RefObject<ReactFlowInstance<AppNode, Edge> | null>;
  onSelect: (node: CommitFlowNode, at: { x: number; y: number }) => void;
  onNewWork: (repository: Repository) => void;
  onOpenWork: (request: WorkRequest) => void;
  onShowSession: (session: Session) => void;
  onJumpSession: (session: Session) => void;
  onEndSession: (session: Session) => void;
};

export function useCanvasKeys({
  graph,
  host,
  instance,
  onSelect,
  onNewWork,
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

  // The keys stand on terminals only; an offer is taken, not activated.
  const activate = useCallback(
    (node: AppNode) => {
      if (node.type === "cli") onShowSession(node.data.session);
    },
    [onShowSession],
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

  const take = useCallback(
    ({ data }: OfferFlowNode) => {
      if (data.kind === "new") onNewWork(data.repository);
      else onOpenWork({ repository: data.repository, branch: data.branch, cwd: data.cwd });
    },
    [onNewWork, onOpenWork],
  );

  const { picked, jumps, offering } = useGraphKeys({
    nodes: graph.nodes,
    offers: graph.offers,
    instance,
    host,
    activate,
    jump,
    end: finish,
    take,
  });

  useReadingKeys();

  return {
    picked,
    jumps,
    offering,
    selectedCommit,
    setSelectedCommit,
    handleCommitClick,
    handleNodeClick,
  };
}

/**
 * What the canvas answers a press with: a commit picked out, a node activated,
 * and a terminal reached by its number.
 */

import type { Edge, NodeMouseHandler, ReactFlowInstance } from "@xyflow/react";
import { type RefObject, useCallback, useState } from "react";
import type { WorkRequest } from "../components/graphActions";
import type { AppNode, CommitFlowNode, GraphResult } from "../lib/graph";
import { centreOf } from "../lib/graphNav";
import type { Session } from "../lib/session";
import { useGraphKeys } from "./useGraphKeys";
import { useReadingKeys } from "./useReadingSize";

export type KeysCanvas = {
  graph: GraphResult;
  host: RefObject<HTMLDivElement | null>;
  instance: RefObject<ReactFlowInstance<AppNode, Edge> | null>;
  /** Whether there is a file card to read, which the size keys answer for. */
  reading: boolean;
  expand: (repository: string) => void;
  onSelect: (node: CommitFlowNode, at: { x: number; y: number }) => void;
  onOpenWork: (request: WorkRequest) => void;
  onShowSession: (session: Session) => void;
  onJumpSession: (session: Session) => void;
};

export function useCanvasKeys({
  graph,
  host,
  instance,
  reading,
  expand,
  onSelect,
  onOpenWork,
  onShowSession,
  onJumpSession,
}: KeysCanvas) {
  // Commit marks are drawn in the shared SVG rather than as React Flow nodes,
  // so their selection is the one small piece of canvas state kept here.
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null);
  const handleCommitClick = useCallback(
    (node: CommitFlowNode, at: { x: number; y: number }) => {
      setSelectedCommit(node.id);
      onSelect(node, at);
    },
    [onSelect],
  );

  // Picking any remaining HTML node takes the emphasis off a commit.
  const handleNodeClick: NodeMouseHandler<AppNode> = () => setSelectedCommit(null);

  /**
   * Where a walk with the cursor keys arrived.
   *
   * A commit reached that way is picked out the same as one that was clicked,
   * and it stays picked out after Ctrl is let go: the ring the walk wears goes
   * with the key it is held by, and the offer standing over what it found does
   * not. Landing anywhere else takes the emphasis off a commit, which is what
   * clicking anywhere else does as well.
   */
  const land = useCallback((node: AppNode | null) => {
    setSelectedCommit(node?.type === "commit" ? node.id : null);
  }, []);

  /**
   * Does to a node what clicking it would.
   *
   * A session goes into the panel, a branch opens a shell in it — which is what
   * the button on its ring does — and the rest do the one thing they are there
   * for. Enter is the keyboard's click, so it has to mean the same as the click
   * does.
   */
  // biome-ignore lint/correctness/useExhaustiveDependencies: the refs are the canvas's own and never change identity
  const activate = useCallback(
    (node: AppNode) => {
      switch (node.type) {
        case "cli":
          // A terminal that is this window's own goes into the panel; somebody
          // else's answers to nothing.
          if (node.data.session) onShowSession(node.data.session);
          return;
        case "ask":
          // What the card's own head does under the pointer: everything a
          // question is too small to hold is in the terminal it was asked in.
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
          // A commit answers with its menu, where the cursor would have opened it.
          const at = instance.current?.flowToScreenPosition(centreOf(graph.nodes, node.id));
          if (at) onSelect(node, at);
          return;
        }
      }
    },
    [expand, graph.nodes, onOpenWork, onSelect, onShowSession],
  );

  /**
   * Goes to a terminal that was asked for by its number.
   *
   * Apart from `activate` because it means something else: Return is the
   * keyboard's click and a click on a terminal's mark is a toggle, while a
   * number names one terminal and has to land on it whether or not the panel is
   * already holding it.
   */
  const jump = useCallback(
    (node: AppNode) => {
      if (node.type === "cli") onJumpSession(node.data.session);
    },
    [onJumpSession],
  );

  const { picked, jumps } = useGraphKeys({
    nodes: graph.nodes,
    instance,
    host,
    activate,
    jump,
    land,
    selected: selectedCommit,
  });

  // Ctrl and a plus or a minus, for as long as there is a file card to read.
  useReadingKeys(reading);

  return { picked, jumps, selectedCommit, setSelectedCommit, handleCommitClick, handleNodeClick };
}

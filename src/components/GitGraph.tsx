import {
  type Edge,
  ReactFlow,
  type ReactFlowInstance,
  useNodesState,
  type Viewport,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useCanvasDrag } from "../hooks/useCanvasDrag";
import { MAX_ZOOM, MIN_ZOOM, useCanvasFold } from "../hooks/useCanvasFold";
import { useCanvasKeys } from "../hooks/useCanvasKeys";
import { useFilePreviews } from "../hooks/useFilePreviews";
import { useFolderPlaces } from "../hooks/useFolderPlaces";
import { useFolderView } from "../hooks/useFolderView";
import { useHistoryDepth } from "../hooks/useHistoryDepth";
import { useNodeGlide } from "../hooks/useNodeGlide";
import { useSettingsPage } from "../hooks/useSettingsPage";
import { useWorktreeStatus } from "../hooks/useWorktreeStatus";
import { type AppNode, buildCommitGraph, type GraphResult } from "../lib/graph";
import { useCanvasActions } from "./canvasActions";
import { CliJumpsProvider } from "./cliJumps";
import { GraphLines } from "./GraphLines";
import { GraphActionsProvider } from "./graphActions";
import {
  DETAIL_GAP,
  DETAIL_ZOOM,
  FIT_DELAY_MS,
  nodeTypes,
  proOptions,
  retainLineNodes,
} from "./graphCanvas";
import { GraphMarksProvider } from "./graphMarks";
import type { GraphProps } from "./graphProps";
import { PinnedCards } from "./PinnedCards";
import { SettingsControlsProvider } from "./settings/SettingsControls";

export type { BranchPick, FetchRequest } from "./graphActions";
export type { MergeRequest } from "./graphProps";

import { WorktreeStatusProvider } from "./worktreeStatus";

import "@xyflow/react/dist/style.css";
import "../canvas/index.css";

export function GitGraph({
  workspace,
  folders,
  sessions,
  showing,
  asks,
  reports,
  onAnswer,
  onReply,
  onPoint,
  onPick,
  onCompose,
  onTake,
  marks,
  onSelect,
  onOpenWork,
  onBrowseWorktree,
  onPickBranch,
  onCloseRepository,
  onMerge,
  onFetch,
  onShowSession,
  onJumpSession,
  onEndSession,
  filePreviews,
  onCloseFilePreview,
  settingsOpen,
  mcp,
  onCloseSettings,
}: GraphProps) {
  // The graph React Flow is currently showing, which is what the next one is
  // built against.
  const applied = useRef<GraphResult | null>(null);
  const depth = useHistoryDepth(workspace.repositories);
  const { visible, reaching } = depth;
  // What each worktree has uncommitted, which the branch rings are drawn from.
  const worktreeStatus = useWorktreeStatus(workspace);
  const { opened, openRepository, foldRepository, toggleFolder } = useFolderView(folders);
  // Where each folder has been carried to, which is the one thing about this
  // canvas that was decided by hand rather than laid out.
  const { places, placeFolder } = useFolderPlaces();
  const graph = useMemo(
    () =>
      buildCommitGraph(
        { workspace, folders, visible, opened, sessions, showing, asks, reports, reaching, places },
        applied.current ?? undefined,
      ),
    [workspace, folders, visible, opened, sessions, showing, asks, reports, reaching, places],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState<AppNode>(graph.nodes);
  const instance = useRef<ReactFlowInstance<AppNode, Edge> | null>(null);
  const [flowReady, setFlowReady] = useState(false);
  const framed = useRef(false);
  /** The canvas itself, which the cursor keys measure their panning against. */
  const host = useRef<HTMLDivElement>(null);
  const glide = useNodeGlide(setNodes);
  // Where everything is standing on screen, which is where the next move starts
  // from — mid-move included, so a second change does not jump.
  const standing = useRef(nodes);
  standing.current = nodes;
  const heldLineNodes = useRef<readonly AppNode[]>(graph.nodes);
  const lineNodes = retainLineNodes(nodes, heldLineNodes.current);
  heldLineNodes.current = lineNodes;

  const { expand, fold, reachFold, keepFold } = useCanvasFold({
    workspace,
    graph,
    applied,
    standing,
    host,
    instance,
    setNodes,
    glide,
    depth,
  });

  const {
    saveFilePreview,
    collapseFilePreview,
    fitFilePreview,
    pinFilePreview,
    pinDrag,
    pinnedFiles,
  } = useFilePreviews(filePreviews, { host, instance, standing, nodes, setNodes, flowReady });
  useSettingsPage(settingsOpen, { host, instance, standing, nodes, setNodes, flowReady });

  // Re-framing is for a canvas that is no longer the one being looked at: a
  // repository appeared or went away. A commit landing must not move the
  // viewport out from under whoever is reading it.
  const repositoryKey = useMemo(
    () => workspace.repositories.map((repository) => repository.id).join("\0"),
    [workspace.repositories],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: the repository set is the trigger, not an input
  useEffect(() => {
    // The first frame is the `fitView` prop's job.
    if (!framed.current) {
      framed.current = true;
      return;
    }
    const timer = setTimeout(() => instance.current?.fitView({ duration: 300 }), FIT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [repositoryKey]);

  /** Whether the canvas is far enough out that the offers are not worth drawing:
   *  out there they are a couple of pixels across. Only the crossing is a change,
   *  which is what makes this cheap. */
  const [coarse, setCoarse] = useState(false);
  const resolve = useCallback((zoom: number) => {
    // Apart, so that settling exactly on the threshold does not put the buttons
    // in and out on alternate frames.
    setCoarse((held) => (held ? zoom < DETAIL_ZOOM : zoom < DETAIL_ZOOM / DETAIL_GAP));
  }, []);

  const shown = useMemo(() => nodes.filter((node) => node.type !== "commit"), [nodes]);

  const handleMove = useCallback(
    (_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
      resolve(viewport.zoom);
    },
    [resolve],
  );

  const { picked, jumps, selectedCommit, setSelectedCommit, handleCommitClick, handleNodeClick } =
    useCanvasKeys({
      graph,
      host,
      instance,
      reading: filePreviews.length > 0,
      expand,
      onSelect,
      onOpenWork,
      onShowSession,
      onJumpSession,
    });

  const { dragBranch, takeGroup, carryGroup, dropGroup } = useCanvasDrag({
    graph,
    standing,
    host,
    instance,
    setNodes,
    placeFolder,
    onMerge,
  });

  const actions = useCanvasActions({
    onOpenWork,
    onBrowseWorktree,
    onPickBranch,
    dragBranch,
    onFetch,
    onCloseRepository,
    openRepository,
    foldRepository,
    toggleFolder,
    expand,
    fold,
    reachFold,
    keepFold,
    onShowSession,
    onEndSession,
    onAnswer,
    onReply,
    onPoint,
    onPick,
    onCompose,
    onTake,
    onCloseFilePreview,
    onCloseSettings,
    saveFilePreview,
    collapseFilePreview,
    fitFilePreview,
    pinFilePreview,
  });

  return (
    <GraphActionsProvider value={actions}>
      <SettingsControlsProvider controls={mcp}>
        <WorktreeStatusProvider value={worktreeStatus}>
          <GraphMarksProvider value={marks}>
            {/* The numbers the terminals are wearing, which is nothing at all
            until Ctrl is held. Only the terminal marks read this, so the key
            costs a render of those and of nothing else on the canvas. */}
            <CliJumpsProvider value={jumps}>
              {/* `is-merging` and the two ends of a merge are written on here by
              `useBranchDrag` rather than handed down, so the class stays put
              across a render: React only writes an attribute whose prop changed,
              and this one never does. Which is why how far out the canvas is
              zoomed is said in an attribute of its own rather than in the class:
              a class React rewrote would take the merge's own marks with it. */}
              <div ref={host} className="graph" data-coarse={coarse || undefined}>
                {/* The canvas stays mounted while folders enter and leave it. Its
                controlled nodes and repository-set framing already carry those
                changes; replacing the instance would initialise an empty view
                before the scanned nodes arrive. */}
                <ReactFlow<AppNode, Edge>
                  nodes={shown}
                  nodeTypes={nodeTypes}
                  onNodesChange={onNodesChange}
                  onInit={(flow) => {
                    instance.current = flow;
                    setFlowReady(true);
                    // The first frame is framed by `fitView` rather than by a move, so
                    // the canvas has to be asked where it ended up.
                    resolve(flow.getViewport().zoom);
                  }}
                  onMove={handleMove}
                  onNodeClick={handleNodeClick}
                  onNodeDragStart={takeGroup}
                  onNodeDrag={carryGroup}
                  onNodeDragStop={dropGroup}
                  onPaneClick={() => setSelectedCommit(null)}
                  nodesConnectable={false}
                  nodesDraggable
                  elevateNodesOnSelect={false}
                  // Commit history is the unbounded part and is one shared SVG;
                  // the small interactive node set stays mounted. React Flow's own
                  // per-frame visibility pass cost more than moving those nodes.
                  onlyRenderVisibleElements={false}
                  minZoom={MIN_ZOOM}
                  maxZoom={MAX_ZOOM}
                  proOptions={proOptions}
                  fitView
                >
                  <GraphLines
                    bands={graph.bands}
                    reach={graph.reach}
                    extent={graph.extent}
                    nodes={lineNodes}
                    selected={selectedCommit}
                    picked={picked}
                    onCommit={handleCommitClick}
                  />
                </ReactFlow>
                <PinnedCards pinnedFiles={pinnedFiles} pinDrag={pinDrag} />
              </div>
            </CliJumpsProvider>
          </GraphMarksProvider>
        </WorktreeStatusProvider>
      </SettingsControlsProvider>
    </GraphActionsProvider>
  );
}

import {
  type Edge,
  type NodeChange,
  ReactFlow,
  type ReactFlowInstance,
  useNodesState,
  type Viewport,
} from "@xyflow/react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { SETTINGS_REQUEST_ID } from "../lib/filePreview";
import {
  type AppNode,
  buildCommitGraph,
  type CliPageFlowNode,
  type FilePreviewFlowNode,
  type GraphResult,
} from "../lib/graph";
import { cliRun } from "../lib/graphNav";
import { gridNow, heldToGrid } from "../lib/grid";
import { usePageWorkspace } from "../page/PageWorkspace";
import { filePageId, terminalPageId } from "../page/placement";
import { frontValue, keepFrontValue, readOnSnapshot } from "../shell/state";
import { TabStrip } from "../tab/TabStrip";
import { BrowsingProvider } from "./browsing";
import { CanvasBackground } from "./CanvasBackground";
import type { CanvasProps } from "./CanvasProps";
import { useCanvasActions } from "./canvasActions";
import { CliDoingProvider } from "./cliDoing";
import { CliJumpsProvider } from "./cliJumps";
import { CliPlacesProvider } from "./cliPlaces";
import { CliTypedProvider } from "./cliTyped";
import { GraphLines } from "./GraphLines";
import { GraphActionsProvider } from "./graphActions";
import { DETAIL_GAP, DETAIL_ZOOM, nodeTypes, proOptions, retainLineNodes } from "./graphCanvas";
import { GraphMarksProvider } from "./graphMarks";
import { HistoryLengthProvider } from "./historyLength";
import { fileLeast } from "./hooks/filePreviewBox";
import { useBrowsedWorktrees } from "./hooks/useBrowsedWorktrees";
import { useCanvasDrag } from "./hooks/useCanvasDrag";
import { MAX_ZOOM, MIN_ZOOM, useCanvasFold } from "./hooks/useCanvasFold";
import { useCanvasKeys } from "./hooks/useCanvasKeys";
import { useCanvasZoom } from "./hooks/useCanvasZoom";
import { useCliPages } from "./hooks/useCliPages";
import { useCliTyped } from "./hooks/useCliTyped";
import { useFilePreviews } from "./hooks/useFilePreviews";
import { useFolderPlaces } from "./hooks/useFolderPlaces";
import { useFolderView } from "./hooks/useFolderView";
import { useHistoryDepth } from "./hooks/useHistoryDepth";
import { useJunctionView } from "./hooks/useJunctionView";
import { useNodeGlide } from "./hooks/useNodeGlide";
import { useSaidStyle } from "./hooks/useSaidStyle";
import { useSettingsPage } from "./hooks/useSettingsPage";
import { useWorktreeStatus } from "./hooks/useWorktreeStatus";
import { Pages } from "./Pages";
import { PinnedCards } from "./PinnedCards";

export type { CanvasProps, MergeRequest, SyncRequest } from "./CanvasProps";
export type { BranchPick, FetchRequest } from "./graphActions";

import { WorktreeStatusProvider } from "./worktreeStatus";

import "./styles/index.css";

export function Canvas({
  workspace,
  folders,
  browsing,
  sessions,
  showing,
  paged,
  asks,
  reports,
  doings,
  onAnswer,
  onReply,
  onPoint,
  onPick,
  onTake,
  marks,
  onSelect,
  onNewWork,
  onOpenWork,
  onBrowseWorktree,
  onPickBranch,
  onCloseRepository,
  onMerge,
  onSync,
  onFetch,
  onShowSession,
  onJumpSession,
  onEndSession,
  filePreviews,
  onPreviewFile,
  onCloseFilePreview,
  onOpenPinned,
  settingsRequest,
  onCloseSettings,
}: CanvasProps) {
  const pages = usePageWorkspace();
  const placement = pages?.placement;
  const forgetPage = pages?.forget;
  const showPage = pages?.show;
  const lastSettings = useRef(settingsRequest);
  useEffect(() => {
    const id = filePageId(SETTINGS_REQUEST_ID);
    if (
      settingsRequest !== lastSettings.current &&
      settingsRequest &&
      placement?.(id) === "sidebar"
    ) {
      showPage?.(id);
    }
    lastSettings.current = settingsRequest;
  }, [settingsRequest, placement, showPage]);
  const applied = useRef<GraphResult | null>(null);
  const depth = useHistoryDepth(workspace.repositories);
  const { visible, reaching } = depth;
  const lengths = useMemo(
    () => ({ visible: depth.visible, free: depth.free, follow: depth.follow }),
    [depth.visible, depth.free, depth.follow],
  );

  const worktreeStatus = useWorktreeStatus(workspace);

  const browsed = useBrowsedWorktrees(workspace, browsing);
  const { opened, openRepository, foldRepository } = useFolderView();

  const { closed, toggleJunction } = useJunctionView();

  const { places, placeFolder } = useFolderPlaces();
  const graph = useMemo(
    () =>
      buildCommitGraph(
        {
          workspace,
          folders,
          visible,
          opened,
          closed,
          sessions,
          showing,
          asks,
          reports,
          reaching,
          places,
        },
        applied.current ?? undefined,
      ),
    [
      workspace,
      folders,
      visible,
      opened,
      closed,
      sessions,
      showing,
      asks,
      reports,
      reaching,
      places,
    ],
  );

  const [nodes, setNodes, changeNodes] = useNodesState<AppNode>([
    ...graph.nodes,
    ...(frontValue<FilePreviewFlowNode[]>("canvas.files") ?? []),
    ...(frontValue<CliPageFlowNode[]>("canvas.clis") ?? []),
  ]);
  const instance = useRef<ReactFlowInstance<AppNode, Edge> | null>(null);
  const [flowReady, setFlowReady] = useState(false);
  // Decided once: React Flow drops a queued first fit when this prop turns false, and the first
  // onMove (a sidebar opening) would turn it false before any node is measured.
  const [fitOnInit] = useState(() => !frontValue("canvas.viewport"));

  const host = useRef<HTMLDivElement>(null);

  const pane = useRef<HTMLDivElement>(null);
  const glide = useNodeGlide(setNodes);

  const standing = useRef(nodes);
  useLayoutEffect(
    () =>
      readOnSnapshot("canvas.files", () =>
        standing.current.filter((node) => node.type === "file-preview"),
      ),
    [],
  );
  useLayoutEffect(
    () =>
      readOnSnapshot("canvas.clis", () =>
        standing.current.filter((node) => node.type === "cli-page"),
      ),
    [],
  );
  standing.current = nodes;

  const onNodesChange = useCallback(
    (changes: NodeChange<AppNode>[]) => {
      const { holding, step } = gridNow();
      if (!holding) return changeNodes(changes);
      const leastOf = (id: string) => {
        const node = standing.current.find((candidate) => candidate.id === id);
        return node?.type === "file-preview" ? fileLeast(node) : null;
      };
      changeNodes(heldToGrid(changes, leastOf, step));
    },
    [changeNodes],
  );
  const heldLineNodes = useRef<readonly AppNode[]>(graph.nodes);
  const lineNodes = retainLineNodes(nodes, heldLineNodes.current);
  heldLineNodes.current = lineNodes;

  useCanvasZoom({ pane, instance });

  useLayoutEffect(() => {
    const canvas = host.current;
    if (!flowReady || !canvas) return;
    let previous = canvas.getBoundingClientRect();

    // Sidebar changes move the canvas origin: offset the viewport by the opposite amount so content keeps its screen position.
    const observer = new ResizeObserver(() => {
      const next = canvas.getBoundingClientRect();
      const dx = previous.left - next.left;
      const dy = previous.top - next.top;
      previous = next;
      const flow = instance.current;
      if (!flow || (dx === 0 && dy === 0)) return;
      const viewport = flow.getViewport();
      void flow.setViewport({
        ...viewport,
        x: viewport.x + dx,
        y: viewport.y + dy,
      });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [flowReady]);

  const fitSaid = useSaidStyle(host);

  const { expand, fold, setLength, reachFold, keepFold } = useCanvasFold({
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
    setFilePreviewView,
    previewFilePreview,
    fitFilePreview,
    pinFilePreview,
    pinDrag,
    pinnedFiles,
  } = useFilePreviews(
    filePreviews,
    { host, instance, standing, nodes, setNodes, flowReady },
    onPreviewFile,

    useMemo(
      () => ({ closeFilePreview: onCloseFilePreview, openPinned: onOpenPinned }),
      [onCloseFilePreview, onOpenPinned],
    ),
  );
  useSettingsPage(settingsRequest, { host, instance, standing, nodes, setNodes, flowReady });
  const { collapseCliPage, fitCliPage } = useCliPages(sessions, paged, showing, {
    host,
    instance,
    standing,
    nodes,
    setNodes,
    flowReady,
  });

  const [coarse, setCoarse] = useState(false);
  const resolve = useCallback(
    (zoom: number) => {
      // Hysteresis, so settling on the threshold does not flicker the offers.
      setCoarse((held) => (held ? zoom < DETAIL_ZOOM : zoom < DETAIL_ZOOM / DETAIL_GAP));

      fitSaid(zoom);
    },
    [fitSaid],
  );

  const handleMove = useCallback(
    (_event: MouseEvent | TouchEvent | null, viewport: Viewport) => {
      keepFrontValue("canvas.viewport", viewport);
      resolve(viewport.zoom);
    },
    [resolve],
  );

  const {
    picked,
    jumps,
    offering,
    selectedCommit,
    setSelectedCommit,
    handleCommitClick,
    handleNodeClick,
  } = useCanvasKeys({
    graph,
    host,
    instance,
    onSelect,
    onNewWork,
    onOpenWork,
    onShowSession,
    onJumpSession,
    onEndSession,
  });

  // Offers ride on top of the canvas's own nodes and only while asked for: they are never in its state.
  const shown = useMemo(() => {
    const drawn = nodes
      .filter((node) => node.type !== "commit")
      .map((node) => {
        const id =
          node.type === "file-preview"
            ? filePageId(node.data.requestId)
            : node.type === "cli-page"
              ? terminalPageId(node.data.session.id)
              : null;
        return id && placement?.(id) === "sidebar" ? { ...node, hidden: true } : node;
      });
    return offering ? [...drawn, ...graph.offers] : drawn;
  }, [nodes, offering, graph.offers, placement]);

  const run = useMemo(() => cliRun(graph.nodes), [graph.nodes]);

  const cliPlaces = useMemo(() => new Map(run.map((place) => [place.group, place.name])), [run]);

  const typed = useCliTyped(jumps !== null, showing, asks, reports);

  const { dragBranch, takeGroup, carryGroup, dropGroup } = useCanvasDrag({
    graph,
    standing,
    host,
    instance,
    setNodes,
    placeFolder,
    onMerge,
    onSync,
  });

  const closePage = useCallback(
    (id: number) => {
      forgetPage?.(filePageId(id));
      if (id === SETTINGS_REQUEST_ID) onCloseSettings();
      else onCloseFilePreview(id);
    },
    [onCloseSettings, onCloseFilePreview, forgetPage],
  );

  const actions = useCanvasActions({
    onOpenWork,
    onNewWork,
    onBrowseWorktree,
    onPickBranch,
    dragBranch,
    onFetch,
    onCloseRepository,
    openRepository,
    foldRepository,
    toggleJunction,
    expand,
    fold,
    setLength,
    reachFold,
    keepFold,
    onShowSession,
    onEndSession,
    collapseCliPage,
    fitCliPage,
    onAnswer,
    onReply,
    onPoint,
    onPick,
    onTake,
    onCloseFilePreview: closePage,
    saveFilePreview,
    collapseFilePreview,
    setFilePreviewView,
    previewFilePreview,
    fitFilePreview,
    pinFilePreview,
  });

  return (
    <GraphActionsProvider value={actions}>
      <HistoryLengthProvider value={lengths}>
        <WorktreeStatusProvider value={worktreeStatus}>
          <BrowsingProvider value={browsed}>
            <GraphMarksProvider value={marks}>
              <CliJumpsProvider value={jumps}>
                <CliPlacesProvider value={cliPlaces}>
                  <CliDoingProvider value={doings}>
                    <CliTypedProvider value={typed}>
                      {/* is-merging is written on this element by useBranchDrag, not rendered: React only rewrites attributes whose prop changed. Zoom is a separate data attribute for the same reason. */}
                      <div ref={host} className="graph" data-coarse={coarse || undefined}>
                        <ReactFlow<AppNode, Edge>
                          ref={pane}
                          nodes={shown}
                          nodeTypes={nodeTypes}
                          onNodesChange={onNodesChange}
                          onInit={(flow) => {
                            instance.current = flow;
                            const kept = frontValue<Viewport>("canvas.viewport");
                            if (kept) void flow.setViewport(kept);
                            setFlowReady(true);

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
                          // React Flow's per-frame visibility pass cost more than moving the nodes.
                          onlyRenderVisibleElements={false}
                          minZoom={MIN_ZOOM}
                          maxZoom={MAX_ZOOM}
                          // The wheel is useCanvasZoom's, which zooms on the canvas middle rather than the cursor.
                          zoomOnScroll={false}
                          proOptions={proOptions}
                          // Never re-fitted once looked at: a fit moves the canvas out from under the reader.
                          fitView={fitOnInit}
                        >
                          <CanvasBackground />
                          <Pages
                            nodes={nodes}
                            sessions={sessions}
                            status={
                              run.length > 1 ? (
                                <TabStrip run={run} showing={showing} doings={doings} />
                              ) : undefined
                            }
                          />
                          <GraphLines
                            bands={graph.bands}
                            reach={graph.reach}
                            holds={graph.holds}
                            extent={graph.extent}
                            nodes={lineNodes}
                            selected={selectedCommit}
                            picked={picked}
                            offering={offering}
                            reading={offering && !coarse}
                            onCommit={handleCommitClick}
                          />
                        </ReactFlow>
                        <PinnedCards
                          pinnedFiles={pinnedFiles.filter(
                            (node) => placement?.(filePageId(node.data.requestId)) !== "sidebar",
                          )}
                          pinDrag={pinDrag}
                        />
                      </div>
                    </CliTypedProvider>
                  </CliDoingProvider>
                </CliPlacesProvider>
              </CliJumpsProvider>
            </GraphMarksProvider>
          </BrowsingProvider>
        </WorktreeStatusProvider>
      </HistoryLengthProvider>
    </GraphActionsProvider>
  );
}

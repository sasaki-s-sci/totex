import {
  type Edge,
  ReactFlow,
  type ReactFlowInstance,
  useNodesState,
  type Viewport,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useBrowsedWorktrees } from "../hooks/useBrowsedWorktrees";
import { useCanvasDrag } from "../hooks/useCanvasDrag";
import { MAX_ZOOM, MIN_ZOOM, useCanvasFold } from "../hooks/useCanvasFold";
import { useCanvasKeys } from "../hooks/useCanvasKeys";
import { useCanvasZoom } from "../hooks/useCanvasZoom";
import { useCliTyped } from "../hooks/useCliTyped";
import { useCommitMessage } from "../hooks/useCommitMessage";
import { useFilePreviews } from "../hooks/useFilePreviews";
import { useFolderPlaces } from "../hooks/useFolderPlaces";
import { useFolderView } from "../hooks/useFolderView";
import { useHistoryDepth } from "../hooks/useHistoryDepth";
import { useNodeGlide } from "../hooks/useNodeGlide";
import { useSettingsPage } from "../hooks/useSettingsPage";
import { useWorktreeStatus } from "../hooks/useWorktreeStatus";
import { type AppNode, buildCommitGraph, type GraphResult } from "../lib/graph";
import { cliRun } from "../lib/graphNav";
import { BrowsingProvider } from "./browsing";
import { useCanvasActions } from "./canvasActions";
import { CliDoingProvider } from "./cliDoing";
import { CliJumpsProvider } from "./cliJumps";
import { CliPlacesProvider } from "./cliPlaces";
import { CliTypedProvider } from "./cliTyped";
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
export type { MergeRequest, SyncRequest } from "./graphProps";

import { WorktreeStatusProvider } from "./worktreeStatus";

import "@xyflow/react/dist/style.css";
import "../canvas/index.css";

export function GitGraph({
  workspace,
  folders,
  browsing,
  sessions,
  showing,
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
  onCutBranch,
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
  onCliRun,
  filePreviews,
  onPreviewFile,
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
  // And which of them the column is standing in, which is drawn inside them.
  const browsed = useBrowsedWorktrees(workspace, browsing);
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
  /** React Flow's own element inside it, which is where the wheel is heard.
   *  The pinned cards are drawn over the canvas rather than on it, and a wheel
   *  turned on one of those is not the canvas being zoomed. */
  const pane = useRef<HTMLDivElement>(null);
  const glide = useNodeGlide(setNodes);
  // Where everything is standing on screen, which is where the next move starts
  // from — mid-move included, so a second change does not jump.
  const standing = useRef(nodes);
  standing.current = nodes;
  const heldLineNodes = useRef<readonly AppNode[]>(graph.nodes);
  const lineNodes = retainLineNodes(nodes, heldLineNodes.current);
  heldLineNodes.current = lineNodes;

  useCanvasZoom({ pane, instance });

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
    diffFilePreview,
    previewFilePreview,
    fitFilePreview,
    pinFilePreview,
    pinDrag,
    pinnedFiles,
  } = useFilePreviews(
    filePreviews,
    { host, instance, standing, nodes, setNodes, flowReady },
    onPreviewFile,
  );
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

  const {
    picked,
    jumps,
    reading,
    selectedCommit,
    setSelectedCommit,
    handleCommitClick,
    handleNodeClick,
  } = useCanvasKeys({
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
  });

  // The commit the walk is standing on, while the history is being read. The
  // rest of them say their subject, which the canvas already has; this is the
  // one that says the whole of what it says, so it is the one worth asking git
  // about — and only for as long as somebody is stopped on it.
  const readingCommit = useMemo(() => {
    if (!reading || !picked) return null;
    const node = graph.nodes.find((candidate) => candidate.id === picked);
    return node?.type === "commit" ? node : null;
  }, [reading, picked, graph.nodes]);
  const message = useCommitMessage(readingCommit);

  // The same numbers, said to the window: the panel draws this run in its band,
  // and where a terminal ended up on the canvas is the only place the number
  // that reaches it comes from. Told on the change rather than every render —
  // the run is a handful of ids, and the graph is rebuilt for every commit that
  // lands.
  const run = useMemo(() => cliRun(graph.nodes), [graph.nodes]);
  useEffect(() => onCliRun(run), [run, onCliRun]);

  // The same run again, read by the row rather than by the number: what the
  // strip heads each run with is what a mark out on the canvas has to say it is
  // standing in, so the two are taken from the one reading and cannot drift.
  // Only the rows something is running in are in here, which is every row that
  // could ask.
  const cliPlaces = useMemo(() => new Map(run.map((place) => [place.group, place.name])), [run]);

  // And what each of those numbers is standing beside, taken at the press and
  // held for as long as the key is — or kept on all the time, where the window
  // has been told to in settings. The numbers are what a key would reach; the
  // lines are which terminal is which.
  const typed = useCliTyped(jumps !== null, asks, reports);

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
    onTake,
    onCloseFilePreview,
    onCloseSettings,
    saveFilePreview,
    collapseFilePreview,
    diffFilePreview,
    previewFilePreview,
    fitFilePreview,
    pinFilePreview,
  });

  return (
    <GraphActionsProvider value={actions}>
      <SettingsControlsProvider controls={mcp}>
        <WorktreeStatusProvider value={worktreeStatus}>
          {/* Where the column is looking, which is a mark on the rings and
          nothing else on the canvas. */}
          <BrowsingProvider value={browsed}>
            <GraphMarksProvider value={marks}>
              {/* The numbers the terminals are wearing, which is nothing at all
            until Ctrl is held. Only the terminal marks read this, so the key
            costs a render of those and of nothing else on the canvas. */}
              <CliJumpsProvider value={jumps}>
                {/* And where each of them is standing, which is what a number
              cannot say: a mark wearing one says which key reaches it, and
              this says what the terminal being read is running in. The run the
              panel's strip is drawn from, keyed by the row it heads — one
              reading of one canvas, said out here as well as in the band. */}
                <CliPlacesProvider value={cliPlaces}>
                  {/* And what each of them is running, which unlike the two above is
                not a key being held: it is on the canvas all the time, because a
                stack of identical glyphs cannot otherwise say which of them is
                busy and which is an agent somebody is working with. Through
                context for the same reason those are — a session turns over twice
                a command, and the layout is not rebuilt for that. */}
                  <CliDoingProvider value={doings}>
                    {/* And what each of them was last told to do, which is the
                  other half of the same key — or standing on its own, where the
                  lines have been asked for outright: the number says which mark
                  a press would reach, and the line says which terminal that mark
                  is. */}
                    <CliTypedProvider value={typed}>
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
                          ref={pane}
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
                          // The wheel is `useCanvasZoom`'s: d3-zoom holds the point
                          // under the cursor still, and this canvas comes in on its
                          // own middle instead. A pinch is still React Flow's.
                          zoomOnScroll={false}
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
                            // Not out where a line of this is two pixels tall:
                            // words at that scale are a grey smear over the shape
                            // the canvas was taken out to see.
                            reading={reading && !coarse}
                            message={message}
                            onCommit={handleCommitClick}
                          />
                        </ReactFlow>
                        <PinnedCards pinnedFiles={pinnedFiles} pinDrag={pinDrag} />
                      </div>
                    </CliTypedProvider>
                  </CliDoingProvider>
                </CliPlacesProvider>
              </CliJumpsProvider>
            </GraphMarksProvider>
          </BrowsingProvider>
        </WorktreeStatusProvider>
      </SettingsControlsProvider>
    </GraphActionsProvider>
  );
}

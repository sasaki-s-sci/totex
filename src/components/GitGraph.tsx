import {
  type Edge,
  getViewportForBounds,
  type NodeMouseHandler,
  type NodeTypes,
  type OnNodeDrag,
  ReactFlow,
  type ReactFlowInstance,
  useNodesState,
  type Viewport,
  type XYPosition,
} from "@xyflow/react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readFileHead, writeFile } from "../folder/api";
import { baseName } from "../folder/format";
import { useBranchDrag } from "../hooks/useBranchDrag";
import { useFolderPlaces } from "../hooks/useFolderPlaces";
import { useFolderView } from "../hooks/useFolderView";
import { useGraphKeys } from "../hooks/useGraphKeys";
import { useHistoryDepth } from "../hooks/useHistoryDepth";
import { useNodeGlide } from "../hooks/useNodeGlide";
import { heldInPane, usePinDrag } from "../hooks/usePinDrag";
import { useReadingKeys } from "../hooks/useReadingSize";
import type { Folder } from "../hooks/useWorkspace";
import { useWorktreeStatus } from "../hooks/useWorktreeStatus";
import type { Ask } from "../lib/ask";
import type { FilePreviewRequest } from "../lib/filePreview";
import type { CommitFlowNode, FilePreviewBox, FilePreviewFlowNode } from "../lib/graph";
import {
  type AppNode,
  buildCommitGraph,
  COLUMN_WIDTH,
  commitNodeId,
  type GraphResult,
  HEAD_SIZE,
  LANE_HEIGHT,
} from "../lib/graph";
import { reconcile } from "../lib/graph/reconcile";
import { centreOf } from "../lib/graphNav";
import type { Report } from "../lib/mcp";
import type { Session } from "../lib/session";
import type { Repository, Workspace } from "../types/git";
import { CliJumpsProvider } from "./cliJumps";
import { GraphLines } from "./GraphLines";
import { type BranchPick, GraphActionsProvider, type WorkRequest } from "./graphActions";
import { type GraphMarks, GraphMarksProvider } from "./graphMarks";
import { AskNode } from "./nodes/AskNode";
import { BranchHeadNode } from "./nodes/BranchHeadNode";
import { CliNode } from "./nodes/CliNode";
import { CollapseNode } from "./nodes/CollapseNode";
import { FilePreviewCard, FilePreviewNode, MIN_HEIGHT, MIN_WIDTH } from "./nodes/FilePreviewNode";
import { FolderNode } from "./nodes/FolderNode";
import { RepoMarkNode } from "./nodes/RepoMarkNode";
import { ReportNode } from "./nodes/ReportNode";
import { RepositoryNode } from "./nodes/RepositoryNode";
import { WorktreeStatusProvider } from "./worktreeStatus";

import "@xyflow/react/dist/style.css";
import "../graph.css";

const nodeTypes = {
  repository: RepositoryNode,
  folder: FolderNode,
  "repo-mark": RepoMarkNode,
  head: BranchHeadNode,
  collapse: CollapseNode,
  cli: CliNode,
  ask: AskNode,
  report: ReportNode,
  "file-preview": FilePreviewNode,
} satisfies NodeTypes;

/** The canvas is the whole window here; the badge sits on top of the graph. */
const proOptions = { hideAttribution: true };

/** Lets React Flow measure the nodes it was just handed before re-framing. */
const FIT_DELAY_MS = 80;

/**
 * The scale below which the offer of a terminal stops being drawn.
 *
 * A third of full size: the button on a branch's ring is then about a fifth of
 * the size a pointer can be aimed at, and what it is drawn in is four pixels of
 * grey. What is left out there is the shape of the history, which is what the
 * canvas is taken out to see.
 *
 * Said to the stylesheet rather than answered by leaving something out: the
 * button is part of a branch's own mark now, and a branch is drawn at every
 * scale.
 */
const DETAIL_ZOOM = 0.3;
/** How far past the threshold the canvas has to come back for them to return. */
const DETAIL_GAP = 1.2;

/**
 * How far the canvas may be taken, either way.
 *
 * Far enough out to hold a workspace of long histories — a pull standing the
 * canvas back to fit one runs into this and no sooner — and far enough in for a
 * commit to be a thing rather than a dot.
 */
const MIN_ZOOM = 0.02;
const MAX_ZOOM = 5;
/** The share of the pane left round what is framed, which is `fitView`'s own. */
const FIT_PADDING = 0.1;
/** How long the canvas takes to come back from a pull that asked for nothing. */
const RETURN_MS = 200;

const FILE_PREVIEW_SIZE = { width: 360, height: 240 } as const;

/**
 * The layer a file card stands on.
 *
 * A file is opened onto the graph, not into it: whatever it is dropped over, it
 * is the thing being read. React Flow draws a node nested in another a step
 * above the one it sits in, so a repository's own marks came out over a card
 * left standing on the band. Well clear of that stack of steps, and of the
 * thousand a selected node would be lifted by if this canvas ever lifted one.
 */
const FILE_PREVIEW_Z = 1_100;

function fileNodeId(requestId: number): string {
  return `file-preview:${requestId}`;
}

/**
 * The size a card is standing at.
 *
 * Its own, once an edge has been dragged — a resize writes the width and the
 * height onto the node — and the size it was opened at until then. A card put
 * away has no height of its own, so the box keeps the one it had.
 */
function fileSize(node: FilePreviewFlowNode): FilePreviewBox {
  const box = node.data.box;
  return { width: node.width ?? box.width, height: node.height ?? box.height };
}

/**
 * A box a card is still a card at.
 *
 * Stepping on and off the canvas multiplies a card's box by the zoom, and a
 * graph taken far out would pin a card at a few pixels of itself. Held at the
 * floor its own edges are dragged to, so that what comes back is always
 * something that can be read and reached for.
 */
function readableSize(box: FilePreviewBox): FilePreviewBox {
  return { width: Math.max(MIN_WIDTH, box.width), height: Math.max(MIN_HEIGHT, box.height) };
}

/**
 * Keeps the line layer's input stable while only file cards are changing.
 *
 * A controlled React Flow reports every drag frame as a new node array. File
 * cards have no lines, but handing that array to `GraphLines` made it rebuild
 * every history path while a card moved. Comparing the relevant objects is a
 * small linear pass and lets the memoized line layer sleep through the drag.
 */
function retainLineNodes(nodes: readonly AppNode[], held: readonly AppNode[]): readonly AppNode[] {
  let index = 0;
  let same = true;
  for (const node of nodes) {
    if (node.type === "file-preview") continue;
    if (held[index] !== node) same = false;
    index += 1;
  }

  if (same && held.length === index) return held;
  return nodes.filter((node) => node.type !== "file-preview");
}

export type { BranchPick };

export type MergeRequest = {
  repository: Repository;
  source: string;
  target: string;
};

type Props = {
  workspace: Workspace;
  /**
   * The folders the graph was opened on, each heading the repositories found
   * through it — which is how the canvas is grouped and what a folder's own row
   * is drawn from.
   */
  folders: readonly Folder[];
  /**
   * What this window is running, in the order it was opened.
   *
   * A terminal is a mark in the column past its repository's branches, joined
   * by a line to the branch it is standing in. Only this window's own: a
   * terminal somebody opened somewhere else cannot be shown here or ended from
   * here, and a mark that answers to nothing is a list entry rather than a
   * thing on a canvas.
   */
  sessions: readonly Session[];
  /** The session the panel is showing, if any. */
  showing: string | null;
  /**
   * What each session has stopped to ask, by session id.
   *
   * Drawn as a card beside the terminal it belongs to, and answered from
   * there: a question is a turn nobody has taken, and the graph is where the
   * window can see that one is outstanding without the panel being opened.
   */
  asks: ReadonlyMap<string, Ask>;
  /**
   * What each session says it is working on, by session id.
   *
   * Drawn in the same place as a question and never at the same time: nothing
   * is waiting on this one, so it is there to be read rather than answered.
   * Empty unless the window is standing a server for the agents to say it
   * through — see `mcp`.
   */
  reports: ReadonlyMap<string, Report>;
  /** One of those answers was taken. */
  onAnswer: (session: Session, ask: Ask, key: string) => void;
  /** Or, for a question with nothing to press, something was written at it. */
  onReply: (session: Session, ask: Ask, text: string) => void;
  /** The agent's own mark was walked to one of the answers, and stopped there. */
  onPoint: (session: Session, ask: Ask, key: string) => void;
  /** One of the answers was picked up, on a list that takes several. */
  onPick: (session: Session, ask: Ask, key: string) => void;
  /** Words were written at the answer the mark is standing in. */
  onCompose: (session: Session, ask: Ask, text: string) => void;
  /** The question was taken where it stands, by the return that ends it. */
  onTake: (session: Session, ask: Ask) => void;
  /**
   * The branches the window is working on, and the ones it was refused.
   *
   * Drawn on their rings and nowhere else: an operation that would not go
   * through is answered where it was asked for, and there is nothing to read.
   */
  marks: GraphMarks;
  /** A commit was clicked, with where on screen it happened. */
  onSelect: (node: CommitFlowNode, at: { x: number; y: number }) => void;
  onOpenWork: (request: WorkRequest) => void;
  onPickBranch: (pick: BranchPick) => void;
  /** The × beside a repository's name: it leaves the canvas. */
  onCloseRepository: (repository: Repository) => void;
  onMerge: (request: MergeRequest) => void;
  onShowSession: (session: Session) => void;
  /**
   * A terminal was reached by its number — Ctrl, and the number the mark wears
   * while Ctrl is held. It goes in the panel and stays there, which is what
   * makes it a jump rather than the press the mark itself answers.
   */
  onJumpSession: (session: Session) => void;
  onEndSession: (session: Session) => void;
  /** Files asked for from the explorer or dropped onto the window. */
  filePreviews: readonly FilePreviewRequest[];
  onCloseFilePreview: (requestId: number) => void;
};

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
  onPickBranch,
  onCloseRepository,
  onMerge,
  onShowSession,
  onJumpSession,
  onEndSession,
  filePreviews,
  onCloseFilePreview,
}: Props) {
  // The graph React Flow is currently showing, which is what the next one is
  // built against.
  const applied = useRef<GraphResult | null>(null);
  const {
    visible,
    reaching,
    expand: expandDepth,
    fold: foldDepth,
    reach,
    keep,
  } = useHistoryDepth();
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

  /**
   * A mark to hold still across the next rebuild, and where it is standing now.
   *
   * Folding and expanding are the one thing that lays a band out from a
   * different end: the history is drawn oldest first, so revealing what was
   * behind the fold gives every commit already on the canvas a column further
   * along, and the band grows into its neighbours. None of that is a reason for
   * the graph to move under whoever asked for it, so the canvas is walked by
   * the same amount instead and the newest commit is left exactly where it was.
   */
  const pinned = useRef<{ id: string; at: XYPosition } | null>(null);

  /**
   * Holds the newest commit of a repository still: the end a history is read
   * from, and the one mark a fold or an expand can never take away.
   *
   * Measured against what is standing on screen rather than against the graph
   * as built, so a fold asked for mid-walk holds the mark where the eye has it.
   */
  const pin = useCallback(
    (repository: string) => {
      const entry = workspace.repositories.find((candidate) => candidate.id === repository);
      const tip = entry?.commits[0];
      if (!entry || !tip) return;
      const id = commitNodeId(entry, tip.id);
      pinned.current = standing.current.some((node) => node.id === id)
        ? { id, at: centreOf(standing.current, id) }
        : null;
    },
    [workspace.repositories],
  );

  const expand = useCallback(
    (repository: string) => {
      pin(repository);
      expandDepth(repository);
    },
    [expandDepth, pin],
  );

  const fold = useCallback(
    (repository: string, shown: number) => {
      pin(repository);
      foldDepth(repository, shown);
    },
    [foldDepth, pin],
  );

  /**
   * Stands the canvas back far enough to hold the whole of what is drawn.
   *
   * Worked out from the extent the build measured rather than by asking React
   * Flow to fit its own nodes: a fit is a pass over the store, and the store is
   * handed this frame's nodes after this frame — waiting for that is what
   * `FIT_DELAY_MS` is, and a pull cannot spend it eighty times. The extent is
   * the same box the lines are given, and it is already in hand.
   */
  const standBack = useCallback((extent: { width: number; height: number }) => {
    const flow = instance.current;
    const pane = host.current?.getBoundingClientRect();
    if (!flow || !pane || pane.width === 0 || pane.height === 0) return;
    if (extent.width <= 0 || extent.height <= 0) return;
    flow.setViewport(
      getViewportForBounds(
        { x: 0, y: 0, width: extent.width, height: extent.height },
        pane.width,
        pane.height,
        MIN_ZOOM,
        MAX_ZOOM,
        FIT_PADDING,
      ),
    );
  }, []);

  /**
   * Where the canvas was standing when the pull began.
   *
   * A pull let go where it started asked for nothing, and a canvas left
   * standing back from a graph that never changed would be the one thing such a
   * gesture had left behind. So it is put back, over a moment rather than at
   * once: the band closing up and the canvas coming in are the same movement
   * undone, and a jump would read as a third thing having happened.
   */
  const beforeReach = useRef<Viewport | null>(null);

  const reachFold = useCallback(
    (repository: string, shown: number | null) => {
      if (shown === null) {
        const was = beforeReach.current;
        beforeReach.current = null;
        reach(repository, null);
        if (was) instance.current?.setViewport(was, { duration: RETURN_MS });
        return;
      }
      // Taken on the first frame of the pull and held for the whole of it: the
      // canvas moves on every frame after that, and what it is being put back
      // to is where it was before any of them.
      beforeReach.current ??= instance.current?.getViewport() ?? null;
      reach(repository, shown);
    },
    [reach],
  );

  const keepFold = useCallback(
    (repository: string) => {
      // Nothing to put back: the canvas is standing where the pull left it, and
      // what it is looking at is exactly what was asked for.
      beforeReach.current = null;
      keep(repository);
    },
    [keep],
  );

  // Only what the last workspace change actually moved is handed over; a
  // repository that stayed put keeps the nodes React Flow already measured,
  // selected and drew. What did move is walked there rather than put there.
  useEffect(() => {
    const before = applied.current;
    applied.current = graph;
    const from = new Map(standing.current.map((node) => [node.id, node.position] as const));
    setNodes((current) => {
      const files = current.filter((node) => node.type === "file-preview");
      const history = current.filter((node) => node.type !== "file-preview");
      const merged = reconcile(history, graph.nodes, before?.nodes, (rebuilt, holding) => ({
        ...rebuilt,
        selected: holding.selected,
        measured: holding.measured,
      }));
      return [...merged, ...files];
    });

    // A pull is under way, and the band it is in was laid out again for this
    // very frame of it. Nothing is walked and nothing is held still: what is
    // drawn is what the hand is asking for, the fold it is on stays at the
    // column it has always been at, and the history runs out to the right of it
    // — which is a band that is wider every frame. The canvas takes that by
    // standing back far enough to hold the whole of what is now drawn.
    if (reaching) {
      pinned.current = null;
      standBack(graph.extent);
      return;
    }

    // A fold or an expand: the canvas takes the whole of the move, so nothing
    // on it appears to have moved at all — the history that arrives comes in
    // from the side, and the commit under the cursor stays under the cursor.
    // Nothing is walked here either: a walk is how a node says it is the same
    // node somewhere else, and none of them are anywhere else.
    const held = pinned.current;
    pinned.current = null;
    const view = held ? instance.current?.getViewport() : undefined;
    if (held && view && graph.nodes.some((node) => node.id === held.id)) {
      const now = centreOf(graph.nodes, held.id);
      instance.current?.setViewport({
        ...view,
        x: view.x - (now.x - held.at.x) * view.zoom,
        y: view.y - (now.y - held.at.y) * view.zoom,
      });
      return;
    }

    glide(from, graph.nodes);
  }, [graph, setNodes, glide, reaching, standBack]);

  // File cards belong to the canvas, but not to a repository rebuild. Each
  // request is placed once in the current viewport and then React Flow owns its
  // position. Reading happens after the loading card appears, and remains
  // bounded by the backend even for very large files.
  const placedFiles = useRef(new Set<number>());
  useEffect(() => {
    if (!flowReady || !instance.current) return;
    const wanted = new Set(filePreviews.map((preview) => preview.id));
    for (const id of placedFiles.current) {
      if (!wanted.has(id)) placedFiles.current.delete(id);
    }

    const fresh = filePreviews.filter((preview) => !placedFiles.current.has(preview.id));
    if (fresh.length === 0) {
      setNodes((current) => {
        const kept = current.filter(
          (node) => node.type !== "file-preview" || wanted.has(node.data.requestId),
        );
        return kept.length === current.length ? current : kept;
      });
      return;
    }

    const bounds = host.current?.getBoundingClientRect();
    const flow = instance.current;
    const additions: FilePreviewFlowNode[] = fresh.map((preview) => {
      placedFiles.current.add(preview.id);
      const stagger = (placedFiles.current.size - 1) % 8;
      const screen = preview.at ?? {
        x: (bounds?.left ?? 0) + (bounds?.width ?? FILE_PREVIEW_SIZE.width) / 2 + stagger * 16,
        y: (bounds?.top ?? 0) + (bounds?.height ?? FILE_PREVIEW_SIZE.height) / 2 + stagger * 16,
      };
      const point = flow.screenToFlowPosition(screen);
      return {
        id: fileNodeId(preview.id),
        type: "file-preview",
        position: {
          x: point.x - FILE_PREVIEW_SIZE.width / 2,
          y: point.y - 17,
        },
        draggable: true,
        dragHandle: ".file-preview__header",
        zIndex: FILE_PREVIEW_Z,
        // Written on the node rather than into its style: a dragged edge is a
        // dimension change, and the node's own width wins over both.
        width: FILE_PREVIEW_SIZE.width,
        height: FILE_PREVIEW_SIZE.height,
        data: {
          requestId: preview.id,
          path: preview.path,
          name: baseName(preview.path),
          text: null,
          size: null,
          truncated: false,
          state: "loading",
          collapsed: false,
          box: FILE_PREVIEW_SIZE,
          pinnedAt: null,
        },
      };
    });

    setNodes((current) => [
      ...current.filter((node) => node.type !== "file-preview" || wanted.has(node.data.requestId)),
      ...additions,
    ]);

    for (const preview of fresh) {
      void readFileHead(preview.path)
        .then((head) => {
          if (!placedFiles.current.has(preview.id)) return;
          setNodes((current) =>
            current.map((node) =>
              node.type === "file-preview" && node.data.requestId === preview.id
                ? {
                    ...node,
                    data: {
                      ...node.data,
                      path: head.path,
                      name: head.name,
                      text: head.text,
                      size: head.size,
                      truncated: head.truncated,
                      state: "ready",
                    },
                  }
                : node,
            ),
          );
        })
        .catch(() => {
          if (!placedFiles.current.has(preview.id)) return;
          setNodes((current) =>
            current.map((node) =>
              node.type === "file-preview" && node.data.requestId === preview.id
                ? { ...node, data: { ...node.data, state: "failed" } }
                : node,
            ),
          );
        });
    }
  }, [filePreviews, flowReady, setNodes]);

  /**
   * Writes one card's reading back to its file.
   *
   * The card holds what is being typed — a keystroke is not something the graph
   * is rebuilt for — and hands it over here when it is to be kept. What comes
   * back is how long the file now is, which is what the next write is checked
   * against, so the card is only told the two things the disk has just settled.
   *
   * A card whose file has not been read whole is never written: the backend
   * refuses it, and so does the card, because what is on screen is only the
   * head of it and writing that back would drop the rest.
   */
  const saveFilePreview = useCallback(
    async (requestId: number, text: string) => {
      const node = standing.current.find(
        (candidate): candidate is FilePreviewFlowNode =>
          candidate.type === "file-preview" && candidate.data.requestId === requestId,
      );
      if (!node || node.data.size === null || node.data.truncated) return false;
      try {
        const size = await writeFile(node.data.path, text, node.data.size);
        setNodes((current) =>
          current.map((one) =>
            one.type === "file-preview" && one.data.requestId === requestId
              ? { ...one, data: { ...one.data, text, size } }
              : one,
          ),
        );
        return true;
      } catch {
        return false;
      }
    },
    [setNodes],
  );

  const collapseFilePreview = useCallback(
    (requestId: number) => {
      setNodes((current) =>
        current.map((node) => {
          if (node.type !== "file-preview" || node.data.requestId !== requestId) return node;
          const collapsed = !node.data.collapsed;
          const size = fileSize(node);
          return {
            ...node,
            data: { ...node.data, collapsed, box: size },
            width: size.width,
            // Put away, the card is given no height at all and the canvas
            // measures what its header comes to — so a header that changes
            // shape has nothing here to be kept in step with.
            height: collapsed ? undefined : size.height,
          };
        }),
      );
    },
    [setNodes],
  );

  /**
   * Puts one card at a width that was measured rather than dragged to.
   *
   * What it needs is the card's own answer — it is the only thing that can see
   * its reading — and how much of that it gets is the canvas's: a minified file
   * is one line a hundred thousand characters long, and a card as wide as that
   * line is a card whose header cannot be reached without the whole graph being
   * zoomed out past reading. So the width is held to what is on screen, which
   * is the widest a card can be and still be a card.
   *
   * Only the width. A reading is as long as the file, and a card as tall as one
   * would be a card with no canvas left around it.
   */
  const fitFilePreview = useCallback(
    (requestId: number, wanted: number) => {
      const room = host.current?.clientWidth ?? 0;
      const zoom = instance.current?.getViewport().zoom ?? 1;
      setNodes((current) =>
        current.map((node) => {
          if (node.type !== "file-preview" || node.data.requestId !== requestId) return node;
          // A pinned card is drawn over the canvas rather than on it, so the
          // room there is for it is the pane itself — the zoom is something it
          // stepped out of when it was pinned.
          const most = node.data.pinnedAt ? room : room / zoom;
          const width = room > 0 ? Math.min(wanted, most) : wanted;
          return { ...node, width, data: { ...node.data, box: { ...fileSize(node), width } } };
        }),
      );
    },
    [setNodes],
  );

  /**
   * Takes a card off the canvas and holds it over the window, or puts it back.
   *
   * Pinned, the node is hidden and the card is drawn on the layer over the
   * graph instead, so nothing the canvas does — a pan, a zoom, a repository
   * opening out and pushing every band along — reaches it. Where it floats is
   * measured in the pane's own pixels, which is the coordinate system it has
   * just stepped into.
   *
   * Unpinned, it goes back under itself rather than back where it came from:
   * the canvas is asked what is now at the point the card has been floating
   * over, and the node is put there. A card pinned, the graph panned across a
   * repository, and the card let go stays on screen where the reader left it.
   *
   * Its box crosses with it. A card on the canvas is drawn at the zoom and one
   * over the window is drawn at none, so the same numbers on either side of the
   * step are two different cards on screen — a graph at half scale pinned a card
   * to twice the size it had just been read at. The box is multiplied by the
   * zoom on the way out and divided by it on the way back, which leaves the card
   * standing at the size it was: what changes is only what it is nailed to.
   */
  const pinFilePreview = useCallback(
    (requestId: number) => {
      const flow = instance.current;
      const pane = host.current?.getBoundingClientRect();
      if (!flow || !pane) return;
      const { zoom } = flow.getViewport();
      setNodes((current) =>
        current.map((node) => {
          if (node.type !== "file-preview" || node.data.requestId !== requestId) return node;
          const at = node.data.pinnedAt;
          const box = fileSize(node);
          // A card put away carries no height of its own — the canvas measures
          // what its header comes to — and one handed back here would give it a
          // body again. The height it had is kept in the box either way.
          const measured = node.height === undefined;
          if (at) {
            const under = readableSize({ width: box.width / zoom, height: box.height / zoom });
            return {
              ...node,
              hidden: false,
              position: flow.screenToFlowPosition({ x: pane.left + at.x, y: pane.top + at.y }),
              width: under.width,
              height: measured ? undefined : under.height,
              data: { ...node.data, box: under, pinnedAt: null },
            };
          }
          const corner = flow.flowToScreenPosition(node.position);
          const over = readableSize({ width: box.width * zoom, height: box.height * zoom });
          return {
            ...node,
            hidden: true,
            width: over.width,
            height: measured ? undefined : over.height,
            data: {
              ...node.data,
              box: over,
              // Held inside the pane by the same rule a drag is, so that a card
              // pinned while it is half off the canvas is not pinned half out
              // of the window.
              pinnedAt: heldInPane(
                { x: corner.x - pane.left, y: corner.y - pane.top },
                pane,
                over.width,
              ),
            },
          };
        }),
      );
    },
    [setNodes],
  );

  /**
   * Where a pinned card has been dragged to, once it is let go.
   *
   * Only then: the card writes where it is standing to its own element for the
   * length of the drag, so the graph is left alone until it comes to rest.
   */
  const movePinned = useCallback(
    (requestId: number, at: { x: number; y: number }) => {
      setNodes((current) =>
        current.map((node) =>
          node.type === "file-preview" && node.data.requestId === requestId
            ? { ...node, data: { ...node.data, pinnedAt: at } }
            : node,
        ),
      );
    },
    [setNodes],
  );

  const pinDrag = usePinDrag(host, movePinned);

  /** The cards that have left the canvas, in the order they were opened. */
  const pinnedFiles = useMemo(
    () =>
      nodes.filter(
        (node): node is FilePreviewFlowNode =>
          node.type === "file-preview" && node.data.pinnedAt !== null,
      ),
    [nodes],
  );

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

  /**
   * Whether the canvas is far enough out that the offers are not worth drawing.
   *
   * There is one of these per branch — the terminal at the foot of its stack —
   * and it is not a thing that happened.
   * Taken out to where a whole workspace fits the window they are a couple of
   * pixels across: nothing can be read off them and nothing can be aimed at
   * them. So out there they are not drawn, and the history they hang off is.
   *
   * Only the crossing is a change, which is what makes this cheap: the zoom
   * itself moves every frame of a pinch, and this answers the same on all but
   * one of them, so React has nothing to do.
   */
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
  useReadingKeys(filePreviews.length > 0);

  /**
   * Which head a screen point is inside, using graph geometry only.
   *
   * Asking the DOM where every ring stands forced a full layout at the start
   * of a merge drag. These are the same centres React Flow draws, transformed
   * back from the screen by the viewport it already owns.
   */
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
          node.data.name === source
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

  /**
   * Stable, so that handing it down does not make every node look changed.
   *
   * Every one of these has to keep its identity across a rebuild for that to
   * hold: the provider's value is compared by identity, so a single callback
   * rebuilt per graph would re-render every edge and every node on the canvas —
   * which is the cost `reconcile` exists to avoid.
   */
  const actions = useMemo(
    () => ({
      openWork: onOpenWork,
      pickBranch: onPickBranch,
      dragBranch,
      closeRepository: onCloseRepository,
      openRepository,
      foldRepository,
      toggleFolder,
      expand,
      fold,
      reachFold,
      keepFold,
      showSession: onShowSession,
      endSession: onEndSession,
      answer: onAnswer,
      reply: onReply,
      point: onPoint,
      pick: onPick,
      compose: onCompose,
      take: onTake,
      closeFilePreview: onCloseFilePreview,
      saveFilePreview,
      collapseFilePreview,
      fitFilePreview,
      pinFilePreview,
    }),
    [
      onOpenWork,
      onPickBranch,
      dragBranch,
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
      saveFilePreview,
      collapseFilePreview,
      fitFilePreview,
      pinFilePreview,
    ],
  );

  return (
    <GraphActionsProvider value={actions}>
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

              {/* The cards that have been pinned off the canvas, drawn over it.
                The layer itself is the whole pane and lets everything through —
                what answers on it is the cards, and the graph underneath answers
                for the rest of it, so a pinned card costs the canvas around it
                nothing. */}
              {pinnedFiles.length > 0 && (
                <div className="graph__pinned">
                  {pinnedFiles.map((node) => {
                    const box = fileSize(node);
                    return (
                      <div
                        key={node.id}
                        className="graph__pin"
                        onPointerDown={(event) => pinDrag.onPointerDown(event, node.data.requestId)}
                        onPointerMove={pinDrag.onPointerMove}
                        onPointerUp={pinDrag.onPointerUp}
                        onPointerCancel={pinDrag.onPointerUp}
                        style={{
                          left: node.data.pinnedAt?.x,
                          top: node.data.pinnedAt?.y,
                          width: box.width,
                          // Put away, a card is as tall as its header, which is
                          // the header's own answer and not a number kept here.
                          height: node.data.collapsed ? undefined : box.height,
                        }}
                      >
                        <FilePreviewCard data={node.data} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </CliJumpsProvider>
        </GraphMarksProvider>
      </WorktreeStatusProvider>
    </GraphActionsProvider>
  );
}

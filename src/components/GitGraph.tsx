import {
  type Edge,
  type NodeMouseHandler,
  type NodeTypes,
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
import { useFolderView } from "../hooks/useFolderView";
import { useGraphKeys } from "../hooks/useGraphKeys";
import { useHistoryDepth } from "../hooks/useHistoryDepth";
import { useNodeGlide } from "../hooks/useNodeGlide";
import { heldInPane, usePinDrag } from "../hooks/usePinDrag";
import { useReadingKeys } from "../hooks/useReadingSize";
import type { Folder } from "../hooks/useWorkspace";
import { useWorktreeStatus } from "../hooks/useWorktreeStatus";
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
import type { Session } from "../lib/session";
import type { Repository, Workspace } from "../types/git";
import type { Agent } from "../types/running";
import { GraphLines } from "./GraphLines";
import { type BranchPick, GraphActionsProvider, type WorkRequest } from "./graphActions";
import { type GraphMarks, GraphMarksProvider } from "./graphMarks";
import { BranchHeadNode } from "./nodes/BranchHeadNode";
import { CliNode } from "./nodes/CliNode";
import { CollapseNode } from "./nodes/CollapseNode";
import { FilePreviewCard, FilePreviewNode } from "./nodes/FilePreviewNode";
import { FolderNode } from "./nodes/FolderNode";
import { RepoMarkNode } from "./nodes/RepoMarkNode";
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
  "file-preview": FilePreviewNode,
} satisfies NodeTypes;

/** The canvas is the whole window here; the badge sits on top of the graph. */
const proOptions = { hideAttribution: true };

/** Lets React Flow measure the nodes it was just handed before re-framing. */
const FIT_DELAY_MS = 80;

/**
 * The scale below which the offer of a terminal stops being drawn.
 *
 * A third of full size: an offer is then about a fifth of the size a pointer
 * can be aimed at, and what it is drawn in is four pixels of grey. What is left
 * out there is the shape of the history, which is what the canvas is taken out
 * to see.
 */
const DETAIL_ZOOM = 0.3;
/** How far past the threshold the canvas has to come back for them to return. */
const DETAIL_GAP = 1.2;

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
  /** What this window is running, in the order it was opened. */
  sessions: readonly Session[];
  /**
   * Every agent the machine is running, this window's own included.
   *
   * A terminal is a mark in the column past its repository's branches, joined
   * by a line drawn through to the branch it is itself driving and by a thinner
   * dashed one to every other checkout it has an agent working in. Whose
   * terminal it is makes no difference to that: the graph is where work is
   * looked for, and a terminal somebody else left running is the same fact
   * about a worktree as one opened here.
   */
  running: readonly Agent[];
  /** The session the panel is showing, if any. */
  showing: string | null;
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
  onEndSession: (session: Session) => void;
  /** Files asked for from the explorer or dropped onto the window. */
  filePreviews: readonly FilePreviewRequest[];
  onCloseFilePreview: (requestId: number) => void;
};

export function GitGraph({
  workspace,
  folders,
  sessions,
  running,
  showing,
  marks,
  onSelect,
  onOpenWork,
  onPickBranch,
  onCloseRepository,
  onMerge,
  onShowSession,
  onEndSession,
  filePreviews,
  onCloseFilePreview,
}: Props) {
  // The graph React Flow is currently showing, which is what the next one is
  // built against.
  const applied = useRef<GraphResult | null>(null);
  const { visible, expand: expandDepth, fold: foldDepth } = useHistoryDepth();
  // What each worktree has uncommitted, which the branch rings are drawn from.
  const worktreeStatus = useWorktreeStatus(workspace);
  const { opened, openRepository, foldRepository, toggleFolder } = useFolderView(folders);
  const graph = useMemo(
    () =>
      buildCommitGraph(
        { workspace, folders, visible, opened, sessions, running, showing },
        applied.current ?? undefined,
      ),
    [workspace, folders, visible, opened, sessions, running, showing],
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
  }, [graph, setNodes, glide]);

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
   */
  const pinFilePreview = useCallback(
    (requestId: number) => {
      const flow = instance.current;
      const pane = host.current?.getBoundingClientRect();
      if (!flow || !pane) return;
      setNodes((current) =>
        current.map((node) => {
          if (node.type !== "file-preview" || node.data.requestId !== requestId) return node;
          const at = node.data.pinnedAt;
          if (at) {
            return {
              ...node,
              hidden: false,
              position: flow.screenToFlowPosition({ x: pane.left + at.x, y: pane.top + at.y }),
              data: { ...node.data, pinnedAt: null },
            };
          }
          const corner = flow.flowToScreenPosition(node.position);
          const box = fileSize(node);
          return {
            ...node,
            hidden: true,
            data: {
              ...node.data,
              // Held inside the pane by the same rule a drag is, so that a card
              // pinned while it is half off the canvas is not pinned half out
              // of the window.
              pinnedAt: heldInPane(
                { x: corner.x - pane.left, y: corner.y - pane.top },
                pane,
                box.width,
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

  const shown = useMemo(() => {
    const interactive = nodes.filter((node) => node.type !== "commit");
    return coarse
      ? interactive.filter((node) => !(node.type === "cli" && node.data.work !== null))
      : interactive;
  }, [nodes, coarse]);

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
   * Does to a node what clicking it would.
   *
   * A session goes into the panel, a branch opens a shell in the panel, and the
   * rest do the one thing they are there for. Enter is the keyboard's click, so
   * it has to mean the same as the click does.
   */
  const activate = useCallback(
    (node: AppNode) => {
      switch (node.type) {
        case "cli": {
          // The room for a terminal opens one; a terminal that is this window's
          // own goes into the panel. Somebody else's answers to nothing.
          const { work, session } = node.data;
          if (work) {
            onOpenWork({
              repository: work.repository,
              branch: work.branch,
              cwd: work.cwd,
              agent: null,
            });
          } else if (session) {
            onShowSession(session);
          }
          return;
        }
        case "head":
          if (node.data.kind === "remote") return;
          onOpenWork({
            repository: node.data.repository,
            branch: node.data.name,
            cwd: node.data.cwd,
            agent: null,
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

  const picked = useGraphKeys({ nodes: graph.nodes, instance, host, activate });

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
      showSession: onShowSession,
      endSession: onEndSession,
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
      onShowSession,
      onEndSession,
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
          {/* `is-merging` and the two ends of a merge are written on here by
            `useBranchDrag` rather than handed down, so the class stays put
            across a render: React only writes an attribute whose prop changed,
            and this one never does. */}
          <div ref={host} className="graph">
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
              onPaneClick={() => setSelectedCommit(null)}
              nodesConnectable={false}
              nodesDraggable
              elevateNodesOnSelect={false}
              // Commit history is the unbounded part and is one shared SVG;
              // the small interactive node set stays mounted. React Flow's own
              // per-frame visibility pass cost more than moving those nodes.
              onlyRenderVisibleElements={false}
              minZoom={0.02}
              maxZoom={5}
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
        </GraphMarksProvider>
      </WorktreeStatusProvider>
    </GraphActionsProvider>
  );
}

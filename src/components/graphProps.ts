/**
 * What the canvas is handed, and what it hands back.
 */

import type { ServingControls } from "../hooks/useServing";
import type { Folder } from "../hooks/useWorkspace";
import type { Ask } from "../lib/ask";
import type { Doing } from "../lib/doing";
import type { FilePreviewRequest } from "../lib/filePreview";
import type { CommitFlowNode, Origin } from "../lib/graph";
import type { CliPlace } from "../lib/graphNav";
import type { Report } from "../lib/mcp";
import type { Session } from "../lib/session";
import type { Repository, Workspace } from "../types/git";
import type { BranchPick, FetchRequest, WorkRequest, WorktreeBrowseRequest } from "./graphActions";
import type { GraphMarks } from "./graphMarks";

export type MergeRequest = {
  repository: Repository;
  source: string;
  target: string;
};

/** A branch to be brought level with its remote, and where that remote end is. */
export type SyncRequest = {
  repository: Repository;
  /** The local branch, which is the end that moves and the mark that waits. */
  branch: string;
  origin: Origin;
};

export type GraphProps = {
  workspace: Workspace;
  /**
   * The folders the graph was opened on, each heading the repositories found
   * through it — which is how the canvas is grouped and what a folder's own row
   * is drawn from.
   */
  folders: readonly Folder[];
  /**
   * Where the folder column's panes are standing.
   *
   * Not what the graph draws — that is `folders`, which is what was actually
   * put on the canvas. This is only where the column is looking, and what the
   * canvas does with it is light the ring of the worktree it is looking into:
   * pressing a ring moves a pane there, and until now nothing said which ring
   * the column had ended up in.
   */
  browsing: readonly string[];
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
  /**
   * What each session is doing, by session id.
   *
   * The one of these three the terminal's own mark draws rather than something
   * standing beside it: a session running an agent wears a mark of its own, one
   * running anything else turns its cursor over, and one at a prompt is drawn
   * as it always was. A session that is not in here is one nothing has been
   * heard about yet.
   */
  doings: ReadonlyMap<string, Doing>;
  /** One of those answers was taken. */
  onAnswer: (session: Session, ask: Ask, key: string) => void;
  /** Or the answer was written: a question with nothing to press, or the row of
   *  a list the agent's own mark is standing in. */
  onReply: (session: Session, ask: Ask, text: string) => void;
  /** The agent's own mark was walked to one of the answers, and stopped there. */
  onPoint: (session: Session, ask: Ask, key: string) => void;
  /** One of the answers was picked up, on a list that takes several. */
  onPick: (session: Session, ask: Ask, key: string) => void;
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
  /**
   * A branch is to be cut at a commit, under the name nobody was asked for.
   *
   * Ctrl and Shift and A, on the commit the walk is standing on: the one thing
   * a commit is for, taken without the menu that would have named it. The
   * canvas has no mark for this — the offer over a dot opens the menu, which is
   * where a name is chosen — so it arrives from the keys and nowhere else.
   */
  onCutBranch: (node: CommitFlowNode) => void;
  onOpenWork: (request: WorkRequest) => void;
  onBrowseWorktree: (request: WorktreeBrowseRequest) => void;
  onPickBranch: (pick: BranchPick) => void;
  /** The × beside a repository's name: it leaves the canvas. */
  onCloseRepository: (repository: Repository) => void;
  onMerge: (request: MergeRequest) => void;
  /**
   * A branch was laid over its own remote end: ask that remote what it has now,
   * and take as much of it as goes without anything to settle by hand.
   */
  onSync: (request: SyncRequest) => void;
  /** A branch's remote end was pulled: ask that remote for the rest of it. */
  onFetch: (request: FetchRequest) => void;
  onShowSession: (session: Session) => void;
  /**
   * A terminal was reached by its number — Ctrl, and the number the mark wears
   * while Ctrl is held. It goes in the panel and stays there, which is what
   * makes it a jump rather than the press the mark itself answers.
   */
  onJumpSession: (session: Session) => void;
  onEndSession: (session: Session) => void;
  /**
   * The terminals as the canvas numbers them, whenever that reading changes.
   *
   * Said rather than asked for: the numbers come out of where the marks ended
   * up, so the canvas is the only side that knows them — and the panel, which
   * draws the same run in its band, is on the other side of the window.
   */
  onCliRun: (run: readonly CliPlace[]) => void;
  /** Files asked for from the explorer or dropped onto the window. */
  filePreviews: readonly FilePreviewRequest[];
  /**
   * A card's file is to be drawn as a page, beside the card it is of.
   *
   * The window's, rather than the canvas's own, because a card standing on the
   * canvas is a card the window was asked for: what the canvas decides is where
   * it goes, which is what `beside` carries.
   */
  onPreviewFile: (path: string, beside: number) => void;
  onCloseFilePreview: (requestId: number) => void;
  /** The window's one settings page, and the controls it draws. */
  settingsOpen: boolean;
  mcp: ServingControls;
  onCloseSettings: () => void;
};

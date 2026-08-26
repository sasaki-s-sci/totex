/**
 * What the canvas is handed, and what it hands back.
 */

import type { ServingControls } from "../hooks/useServing";
import type { Folder } from "../hooks/useWorkspace";
import type { Ask } from "../lib/ask";
import type { FilePreviewRequest } from "../lib/filePreview";
import type { CommitFlowNode, Fetch } from "../lib/graph";
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

/**
 * A branch to be taken up to the remote end it follows, and that end.
 *
 * The other thing a drag can land on. Dropping one branch on another merges the
 * one in hand into the one it landed on, because the branch that moves is the
 * one that was standing still; dropping a branch on its own remote end is the
 * opposite — nothing on a remote moves from here, so what the gesture can only
 * mean is the branch in hand coming up to it.
 */
export type FollowRequest = {
  repository: Repository;
  /** The local branch, which is the end that moves. */
  branch: string;
  /** The end it followed onto: the remote, and the name that remote knows it by. */
  fetch: Fetch;
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
  onOpenWork: (request: WorkRequest) => void;
  onBrowseWorktree: (request: WorktreeBrowseRequest) => void;
  onPickBranch: (pick: BranchPick) => void;
  /** The × beside a repository's name: it leaves the canvas. */
  onCloseRepository: (repository: Repository) => void;
  onMerge: (request: MergeRequest) => void;
  /** A branch was carried onto its own remote end: bring it up to what is there. */
  onFollow: (request: FollowRequest) => void;
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
  /** Files asked for from the explorer or dropped onto the window. */
  filePreviews: readonly FilePreviewRequest[];
  onCloseFilePreview: (requestId: number) => void;
  /** The window's one settings page, and the controls it draws. */
  settingsOpen: boolean;
  mcp: ServingControls;
  onCloseSettings: () => void;
};

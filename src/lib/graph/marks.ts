/**
 * What the marks off the history carry: a repository folded into one, a fold in
 * the history, a terminal, and a file card.
 */

import type { Repository } from "../../types/git";
import type { FilePreviewView } from "../filePreview";
import type { Session } from "../session";
import type { AppNode } from "./flow";
import { CLI_STEP, SESSION_WIDTH } from "./stacks";

/**
 * One repository folded into a single mark, on its own row under its folder.
 *
 * The simplification is the point: a folder of a dozen repositories is a dozen
 * rows of one line each, and pressing one opens that repository's history out
 * in place. Until then the ring is the whole of the repository — everything
 * working in any of its worktrees stands beside that ring, so folding a
 * repository away never loses what is running in it.
 */
export type RepoMarkData = {
  repository: Repository;
};

/** The history that is not being shown, and the way to ask for it. */
export type CollapseNodeData = {
  repository: Repository;
  hidden: number;
};

/**
 * One terminal: the single mark this canvas draws for anything to do with a
 * shell.
 *
 * There used to be three of these — the offer beside a branch, this window's
 * own session, and a terminal the sweep found somebody else running — and they
 * were three shapes in two places. The offer is not a mark at all now: it is
 * the button on the branch's own ring, and pressing it puts one of these on the
 * canvas. So every mark in a stack is a terminal that exists, and the stack is
 * exactly what is running in that branch, oldest first.
 *
 * The whole of what a terminal is is said by its state: whose it is, and what
 * it is running. Which of those it is is read off the two fields below, and
 * there is no third case.
 */
export type CliNodeData = {
  /** The terminal itself, which is what a press on the mark shows and ends. */
  session: Session;
  /** The one the panel is showing, if it is this one. */
  showing: boolean;
  /** Which of the directory's sessions it is, when there is more than one. */
  ordinal: number | null;
};

/**
 * The box every terminal mark is drawn in, wherever it is standing.
 *
 * One box for all of them, which is what lets a stack be read down a single
 * line: a terminal this window opened and one the sweep found somebody else
 * running are the same mark in the same room, and the stack grows by a box
 * rather than by a shape.
 */
export const STACK_STYLE = {
  width: SESSION_WIDTH,
  height: CLI_STEP,
  pointerEvents: "none",
} as const;

/**
 * What the canvas is being built against.
 *
 * Nothing is collected across the build any more: every terminal stands beside
 * the row it is running in, and a row knows where its own marks go — so this is
 * only what did not have to be rebuilt at all.
 */
export type Draw = {
  /** The graph this one replaces, which is what did not have to be rebuilt. */
  before: ReadonlyMap<string, AppNode>;
};

/**
 * How big a file card is, in the units of whatever it is standing in: canvas
 * units while the card is on the canvas, and the pane's own pixels once it has
 * been pinned over the window. Pinning is what carries the box between the two.
 */
export type FilePreviewBox = { width: number; height: number };

/** A bounded file reading shown in a freely placed card on the canvas. */
export type FilePreviewNodeData = {
  requestId: number;
  path: string;
  name: string;
  text: string | null;
  /**
   * The file as something a picture can be drawn from, for a card that is
   * showing one: a data URL of the whole of it, and null for every card that is
   * not — and for a picture too large to have been read at all, which is a card
   * that says so instead.
   */
  picture: string | null;
  size: number | null;
  truncated: boolean;
  state: "loading" | "ready" | "failed";
  /**
   * What the card is showing of it: the file, the patch against the commit
   * under it, or the file drawn as the page it is written to be.
   *
   * Kept here rather than in the card, because a card that is pinned over the
   * window is a card drawn again somewhere else — and what it was showing is
   * not something a pin should put back to the beginning.
   */
  view: FilePreviewView;
  /** The reading is put away and the card is left as tall as its header. */
  collapsed: boolean;
  /**
   * What the card was last left at.
   *
   * The size a card is at belongs to the node itself, because that is what an
   * edge dragged writes to. A card put away has no height of its own for the
   * canvas to measure, so the one it had is kept here to be given back.
   */
  box: FilePreviewBox;
  /**
   * Where the card is pinned over the window, in the canvas pane's own pixels,
   * or null while it is still standing on the canvas.
   *
   * A pinned card has left the canvas: it is drawn over it instead, at the
   * place on screen it was pinned at, and nothing the canvas is dragged or
   * zoomed to reaches it. So where it is cannot be a position on the canvas —
   * that is exactly the coordinate system it has stepped out of — and this is
   * the one it is in instead. The position it left behind is kept on the node,
   * unread until it is put back.
   */
  pinnedAt: { x: number; y: number } | null;
};

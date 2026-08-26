import { createContext, useContext } from "react";

import type { Ask } from "../lib/ask";
import type { Fetch, RefKind } from "../lib/graph";
import type { Session } from "../lib/session";
import type { WorktreeStatus } from "../lib/workspace";
import type { Repository } from "../types/git";

/** A branch, and the terminal to be opened in it. */
export type WorkRequest = {
  /**
   * The repository the branch is in, or null when the directory is not one —
   * a folder opened on the graph, which has no branch and needs none.
   */
  repository: Repository | null;
  /** The branch, or the folder's own name when there is no repository. */
  branch: string;
  /**
   * Where it is checked out. Null only for a branch that has no worktree yet,
   * which is made on the way in; a folder always has one.
   */
  cwd: string | null;
};

/** A branch whose worktree should be browsed in the folder sidebar. */
export type WorktreeBrowseRequest = WorkRequest & { repository: Repository };

/** A branch to be asked of its remote, and the head the asking was done on. */
export type FetchRequest = {
  repository: Repository;
  /** The head the pull was made on, which is the mark that waits for the answer. */
  branch: string;
  fetch: Fetch;
};

/** A branch head that was picked, and where on screen it was. */
export type BranchPick = {
  repository: Repository;
  branch: string;
  kind: RefKind;
  cwd: string | null;
  /**
   * What is uncommitted where it is checked out, carried along rather than
   * asked for again: the head drew its rim from this a moment before the press,
   * and the one thing the menu does with it is name what a deletion would take.
   * Undefined for a branch with no worktree, and for one git has not answered
   * for yet — neither is the same as a worktree with nothing in it.
   */
  status?: WorktreeStatus;
  at: { x: number; y: number };
};

/**
 * What a node can ask the window to do.
 *
 * Passed through context rather than through node data: React Flow compares
 * data by identity to decide what to redraw, and a callback rebuilt on every
 * render would make every node look changed.
 */
export type GraphActions = {
  /** Open a terminal in a branch, making its worktree if need be. */
  openWork: (request: WorkRequest) => void;
  /** Browse a branch's worktree as a folder, making it if need be. */
  browseWorktree: (request: WorktreeBrowseRequest) => void;
  /** A branch head was picked, at this point on screen. */
  pickBranch: (pick: BranchPick) => void;
  /** A branch head is being dragged towards another, to merge into it. */
  dragBranch: (repository: Repository, branch: string, event: React.PointerEvent) => void;
  /**
   * The remote end of a branch was pulled outwards: go and ask that remote for
   * whatever it has of the branch that this machine has not.
   */
  fetchBranch: (request: FetchRequest) => void;
  /**
   * Take a repository off the canvas.
   *
   * Nothing is closed but the drawing of it: the folder it was found in stays
   * open and watched, and anything running in it carries on running. It is
   * drawn again when that folder is taken off the graph and put back.
   */
  closeRepository: (repository: Repository) => void;
  /**
   * Open a repository out into a band of its own, from the mark it is folded
   * into on its folder's row.
   */
  openRepository: (repository: string) => void;
  /** Fold it back into that mark, leaving its folder's row one line again. */
  foldRepository: (repository: string) => void;
  /** The folder's name: open everything in it, or fold everything away. */
  toggleFolder: (root: string) => void;
  /** Show the whole of a repository's history, not just its newest end. */
  expand: (repository: string) => void;
  /** Fold it back down to its newest `shown` commits. */
  fold: (repository: string, shown: number) => void;
  /**
   * How deep a history a pull has reached, which is not yet how deep the
   * repository is showing.
   *
   * The band is laid out at it and drawn as a proposal — dashed throughout —
   * and the canvas stands back far enough to hold the whole of what that comes
   * to. `null` ends the pull having asked for nothing, and puts both back.
   */
  reachFold: (repository: string, shown: number | null) => void;
  /** The pull was let go: what it reached is what the repository shows. */
  keepFold: (repository: string) => void;
  /** Put a running session in the panel, or take it back out again. */
  showSession: (session: Session) => void;
  /** End it: the process stops and it leaves the graph. */
  endSession: (session: Session) => void;
  /**
   * Take one of the answers to what a session is asking.
   *
   * The question goes back with the answer: a card is drawn from a reading that
   * is already a moment old, and the session refuses an answer meant for a
   * question it has moved on from.
   */
  answer: (session: Session, ask: Ask, key: string) => void;
  /**
   * Answer one that asked to be written at, with what was written on the card.
   *
   * Apart from carrying words rather than a key it is the same act, under the
   * same guard: the question goes back with the answer and a question that has
   * moved on refuses it.
   */
  reply: (session: Session, ask: Ask, text: string) => void;
  /**
   * Walk the agent's own mark to one of the answers and stop there.
   *
   * The first of the three that do not end the question. Nothing is settled by
   * it: the agent redraws with its mark somewhere else, and the card follows
   * that reading rather than anything the press assumed.
   */
  point: (session: Session, ask: Ask, key: string) => void;
  /** Pick one of the answers up, or put it down, on a list that takes several. */
  pick: (session: Session, ask: Ask, key: string) => void;
  /**
   * Take the question where it stands, with the return that ends it.
   *
   * What answers the one kind no key answers: a list the answers are picked up
   * from, where every key is a picking up rather than an answer.
   */
  take: (session: Session, ask: Ask) => void;
  /** Take one file card off the canvas. */
  closeFilePreview: (requestId: number) => void;
  /** Take the settings page off the canvas. */
  closeSettings: () => void;
  /**
   * Write one file card's reading back to its file, and say whether it went.
   *
   * The text comes from the card rather than from the node's own data: what is
   * being typed belongs to the card until it is kept, and the graph is not
   * rebuilt for a keystroke.
   */
  saveFilePreview: (requestId: number, text: string) => Promise<boolean>;
  /** Put a file card's reading away, leaving its header, or take it back out. */
  collapseFilePreview: (requestId: number) => void;
  /**
   * Show the patch in place of a card's reading, or put the reading back.
   *
   * The same card either way: what it is showing of its file, and not another
   * card of it. Offered only where there is something to show — a file the
   * commit under it agrees with has no patch, and the header says so by having
   * nothing to press.
   */
  diffFilePreview: (requestId: number) => void;
  /**
   * Open a rendering of a card's file beside it — Ctrl, Shift and V, or the
   * button on its header.
   *
   * Beside rather than in place of, because the two are read against each
   * other: a page is what the file says, and the file is where it is written.
   * One preview to a file, and nothing at all for a file there is no drawing
   * of.
   */
  previewFilePreview: (requestId: number) => void;
  /**
   * Put a file card at the width it asks for, as far as the canvas can show it.
   *
   * The width is worked out by the card, which is the only thing that can see
   * its own reading, and granted here, because the room there is for it belongs
   * to the canvas rather than to any one card.
   */
  fitFilePreview: (requestId: number, width: number) => void;
  /**
   * Take a file card off the canvas and hold it over the window, or put it
   * back where it is now standing.
   *
   * The canvas is the one thing a card cannot be read against: opening a
   * repository, panning to another branch or zooming out to find one all move
   * the card along with everything else. Pinned, it stops being a node and is
   * drawn over the graph instead, at the place on screen it was pinned at.
   */
  pinFilePreview: (requestId: number) => void;
};

const GraphActionsContext = createContext<GraphActions>({
  openWork: () => {},
  browseWorktree: () => {},
  pickBranch: () => {},
  dragBranch: () => {},
  fetchBranch: () => {},
  closeRepository: () => {},
  openRepository: () => {},
  foldRepository: () => {},
  toggleFolder: () => {},
  expand: () => {},
  fold: () => {},
  reachFold: () => {},
  keepFold: () => {},
  showSession: () => {},
  endSession: () => {},
  answer: () => {},
  reply: () => {},
  point: () => {},
  pick: () => {},
  take: () => {},
  closeFilePreview: () => {},
  closeSettings: () => {},
  saveFilePreview: async () => false,
  collapseFilePreview: () => {},
  diffFilePreview: () => {},
  previewFilePreview: () => {},
  fitFilePreview: () => {},
  pinFilePreview: () => {},
});

export const GraphActionsProvider = GraphActionsContext.Provider;

export function useGraphActions(): GraphActions {
  return useContext(GraphActionsContext);
}

import { createContext, useContext } from "react";

import type { AgentId } from "../lib/agents";
import type { Ask } from "../lib/ask";
import type { RefKind } from "../lib/graph";
import type { Session } from "../lib/session";
import type { Repository } from "../types/git";

/** A branch, and what is to be opened in it. */
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
  /** null opens a plain shell. */
  agent: AgentId | null;
};

/** A branch head that was picked, and where on screen it was. */
export type BranchPick = {
  repository: Repository;
  branch: string;
  kind: RefKind;
  cwd: string | null;
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
  /** Open a shell or an agent in a branch, making its worktree if need be. */
  openWork: (request: WorkRequest) => void;
  /** A branch head was picked, at this point on screen. */
  pickBranch: (pick: BranchPick) => void;
  /** A branch head is being dragged towards another, to merge into it. */
  dragBranch: (repository: Repository, branch: string, event: React.PointerEvent) => void;
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
  /** Take one file card off the canvas. */
  closeFilePreview: (requestId: number) => void;
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
  pickBranch: () => {},
  dragBranch: () => {},
  closeRepository: () => {},
  openRepository: () => {},
  foldRepository: () => {},
  toggleFolder: () => {},
  expand: () => {},
  fold: () => {},
  showSession: () => {},
  endSession: () => {},
  answer: () => {},
  closeFilePreview: () => {},
  saveFilePreview: async () => false,
  collapseFilePreview: () => {},
  fitFilePreview: () => {},
  pinFilePreview: () => {},
});

export const GraphActionsProvider = GraphActionsContext.Provider;

export function useGraphActions(): GraphActions {
  return useContext(GraphActionsContext);
}

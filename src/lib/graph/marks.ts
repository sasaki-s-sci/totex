import type { Repository } from "../../types/git";
import type { FilePreviewView } from "../filePreview";
import type { Session } from "../session";
import type { AppNode, OfferFlowNode } from "./flow";
import { CLI_STEP, SESSION_WIDTH } from "./stacks";

export type RepoMarkData = {
  repository: Repository;
};

export type CollapseNodeData = {
  repository: Repository;
  hidden: number;
};

export type JunctionNodeData = {
  /** Without its trailing slash. */
  prefix: string;
  /** Rows of the branch column running through it. */
  members: number;
  closed: boolean;
};

/** Every mark in a stack is a terminal that exists; the offer is on the ring. */
export type CliNodeData = {
  session: Session;
  showing: boolean;
  /** Which of the directory's sessions this is, when there is more than one. */
  ordinal: number | null;
  /** The row it hangs on: a band, a folded repository's mark, or a folder row. See `cliRun`. */
  group: string;
};

/**
 * A terminal that does not exist yet, stood where it would: a branch or folder nothing runs in, or
 * a workspace the repository has not been given. Drawn only while Ctrl+Shift is held.
 */
export type OfferData =
  | { kind: "open"; repository: Repository | null; branch: string; cwd: string | null }
  | { kind: "new"; repository: Repository };

export const STACK_STYLE = {
  width: SESSION_WIDTH,
  height: CLI_STEP,
  pointerEvents: "none",
} as const;

/** A stack mark's box, but pressed: an offer is its own button. */
export const OFFER_STYLE = { width: SESSION_WIDTH, height: CLI_STEP } as const;

export type Draw = {
  /** The graph this one replaces, for reusing nodes that did not change. */
  before: ReadonlyMap<string, AppNode>;
  offered: ReadonlyMap<string, OfferFlowNode>;
};

/** A terminal stood on the canvas as a page; its stack mark stays where it was. */
export type CliPageNodeData = {
  session: Session;
  showing: boolean;
  collapsed: boolean;
  box: FilePreviewBox;
};

/** Canvas units; a pinned card scales the same box by `pinnedScale`. */
export type FilePreviewBox = { width: number; height: number };

export type FilePreviewNodeData = {
  requestId: number;
  path: string;
  name: string;
  text: string | null;
  /** A data URL of the whole file, or null when not a picture or too large to read. */
  picture: string | null;
  size: number | null;
  truncated: boolean;
  state: "loading" | "ready" | "failed";
  /** Kept on the node so pinning does not reset what the card was showing. */
  view: FilePreviewView;
  collapsed: boolean;
  /** Kept here because a collapsed card has no height for the canvas to measure. */
  box: FilePreviewBox;
  /** Pane pixels while pinned over the window; the canvas position stays on the node unread. */
  pinnedScale?: number;
  pinnedAt: { x: number; y: number } | null;
};

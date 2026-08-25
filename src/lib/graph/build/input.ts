/**
 * Everything the canvas is built out of, in one shape.
 */

import type { Folder } from "../../../hooks/useWorkspace";
import type { Workspace } from "../../../types/git";
import type { Ask } from "../../ask";
import type { Report } from "../../mcp";
import type { Session } from "../../session";

/**
 * Turns a scanned workspace into a commit graph for React Flow.
 *
 * `previous` is the graph this one replaces: whatever it already holds in the
 * shape we would have built is handed back rather than rebuilt as an equal
 * copy, so the difference between two graphs is exactly what moved.
 */
export type GraphInput = {
  workspace: Workspace;
  /** The folders the graph was opened on, in the order they were opened. */
  folders: readonly Folder[];
  /**
   * How much history each repository is showing, by id: what a fold or an
   * expand asked for. A repository that has not been asked shows the default.
   */
  visible: ReadonlyMap<string, number>;
  /**
   * Which repositories are opened out into bands, by id.
   *
   * Absent is not closed: a folder holding one repository opens it, and one
   * holding several starts with all of them folded into marks. See `isOpen`.
   */
  opened: ReadonlyMap<string, boolean>;
  /** What this window is running, in the order it was opened. */
  sessions: readonly Session[];
  /** The session the panel is showing, if any. */
  showing: string | null;
  /**
   * What each session is being asked, by session id.
   *
   * The one thing on this canvas that is a turn rather than a state: an agent
   * that has stopped to ask is waiting on the person at the window, and until
   * it is answered nothing else in that session is going to happen. Nearly
   * always empty — see `useAsks`.
   */
  asks: ReadonlyMap<string, Ask>;
  /**
   * What each session says it is working on, by session id.
   *
   * The other of the two things a terminal can have standing beside it, and the
   * quiet one: nothing is waiting, the agent is working, and this is its own
   * account of what it is working on. Empty until somebody has stood the server
   * up and registered it with their agent — see `useReports`.
   */
  reports: ReadonlyMap<string, Report>;
  /**
   * The repository a pull is under way in, if any.
   *
   * Its depth in `visible` is the one the hand has reached rather than the one
   * it has settled on, so everything drawn from it is drawn as a proposal. No
   * other repository is affected: a pull is one hand on one fold.
   */
  reaching: string | null;
  /**
   * How far each folder has been carried from where it would be laid out, by
   * the directory it was opened on.
   *
   * A move rather than a place: the folders are stacked down the canvas in the
   * order they were opened, and a group that has been dragged is drawn that far
   * from the slot it still holds. So the one that was moved is the only one
   * that moved — the folder under it is where it always was, and a repository
   * opening out above still pushes both of them down together.
   */
  places: ReadonlyMap<string, { x: number; y: number }>;
};

/** Mirrors the serde types in `src-tauri/src/running/mod.rs`. */

import type { AgentId } from "../lib/agents";

/**
 * The three, by the same names the rest of the window calls them.
 *
 * Deliberately the catalogue's own type: an agent found running on this machine
 * and an agent this window could start are the same agent, so it wears the same
 * colour and the same mark wherever it is drawn.
 */
export type Tool = AgentId;

/**
 * What an agent is doing.
 *
 * `waiting` is not a kind of idle — it is the one state that is somebody's turn
 * to do something — and `unknown` is honest: opencode publishes nothing about
 * what it is up to, and a session file can be older than the answer.
 */
export type Activity = "busy" | "idle" | "waiting" | "unknown";

/** Where the knowledge came from, which is not the same for all three. */
export type Source = "process" | "session" | "both";

export type Agent = {
  /** Steady from one sweep to the next, which is what keeps its node still. */
  key: string;
  tool: Tool;
  pid: number | null;
  /** The key of the agent that started this one. */
  parent: string | null;
  /** The id the tool's own `resume` takes. */
  sessionId: string | null;
  name: string | null;
  cwd: string;
  /** All four absent together when the directory is not in a repository. */
  repo: string | null;
  worktree: string | null;
  branch: string | null;
  /** The commit, for a checkout that is not on a branch. */
  head: string | null;
  activity: Activity;
  background: boolean;
  /**
   * Started by this window, which draws it as a session of its own.
   *
   * The graph shows one chip per thing running in a worktree, and a terminal
   * this window opened is already one of them — with a button that ends it,
   * which nothing else here has any business offering.
   */
  own: boolean;
  version: string | null;
  startedAt: number | null;
  updatedAt: number | null;
  source: Source;
};

/** The machine, as of one sweep. */
export type Running = {
  agents: Agent[];
};

/**
 * What a session says it is working on, and the door it says it through.
 *
 * The other half of what the window knows about a running agent. A question is
 * read off the screen the agent drew it on, because there is no interface to
 * ask through — see `ask`. What it is *doing* is not on the screen in any shape
 * worth reading, and it does not have to be: the agents speak MCP, so the app
 * stands a server up beside the sessions and is told.
 *
 * Being told rather than reading has one consequence the window has to carry:
 * it only happens where somebody has set it up. The server is off until it is
 * turned on, every session is handed the address of its own door as it starts,
 * and an agent that has been registered against that address says something
 * through it. Where any of that is missing there are no reports, and the graph
 * looks exactly as it did before — which is the same thing the window does
 * about a session that is simply not saying anything.
 *
 * The Rust side is `mcp/`: `serve` is the door, `rpc` is what is said through
 * it, and `install` is the one line of setup written into the agent.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Carries what a session says it is doing, and its going away again. */
export const REPORT_EVENT = "mcp:report";

/** One step of whatever a session is working through. */
export type Step = {
  title: string;
  /**
   * Finished.
   *
   * The first step that is not is the one being worked on, which is why there
   * is no third state here: where a card marks one step as the one in hand, it
   * is working that out rather than being told it.
   */
  done: boolean;
};

/** What a session is working on, in its own words. */
export type Report = {
  /** One line: what is being done right now. */
  doing: string;
  /** The plan that line is a step of, or nothing where there is no plan. */
  steps: Step[];
};

/** A session, and what it says it is doing — or that there is nothing to show. */
export type Reported = {
  id: string;
  report: Report | null;
};

/** The port the server is on, or nothing when it is not standing. */
export function servingNow(): Promise<number | null> {
  return invoke<number | null>("mcp_serving");
}

/**
 * Stands the server up, and says which port it took.
 *
 * Nothing about the sessions already running changes: a terminal is handed its
 * address as it starts, so the ones that began before this have none — and the
 * next one opened does.
 */
export function serve(): Promise<number> {
  return invoke<number>("mcp_serve");
}

/** Takes it down, and takes the reports with it. */
export function stopServing(): Promise<void> {
  return invoke<void>("mcp_stop");
}

/**
 * Everything being worked on right now, for a window that has just come up.
 *
 * The event carries these from moment to moment; this is the first look. A
 * window that only listened would show nothing until an agent next said
 * something, which for one halfway through a long step is a long time.
 */
export function reportsNow(): Promise<Reported[]> {
  return invoke<Reported[]>("mcp_reports");
}

/**
 * Writes the one line of setup into the coding agent on this machine.
 *
 * What comes back is where it was written, which is worth having: on a Windows
 * machine reaching into WSL there is more than one place the agent could be,
 * and this only reaches the ones whose terminals could talk back.
 */
export function install(): Promise<string> {
  return invoke<string>("mcp_install");
}

export function onReport(next: (reported: Reported) => void): Promise<UnlistenFn> {
  return listen<Reported>(REPORT_EVENT, (event) => next(event.payload));
}

/**
 * What each running session is doing, which is what its mark on the canvas is.
 *
 * The stack of terminals on a branch is one glyph drawn over and over, and the
 * one thing somebody reading it wants to know at a glance is which of them is
 * busy — and which of them is not a command being waited on at all but an agent
 * somebody is working with. So the glyph says it: an agent wears a mark of its
 * own, a command that is running turns the terminal's own cursor over, and a
 * shell at its prompt is drawn exactly as it always was.
 *
 * The agent's mark is drawn twice over, because a session somebody is having
 * has two halves: the agent answering, and the agent waiting to be answered.
 * The mark turns for the first and stands still for the second — see
 * `AgentMark`.
 *
 * Read off the session's own screen by the Rust side — see `ask/doing` there
 * for why it is a reading rather than a question put to the process, and
 * `ask/watch` for what holds a screen per session. Sent rather than asked for:
 * this is on the canvas all the time, and a window that had to ask would be a
 * window polling every session for a glyph.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Carries what a session has turned to doing. */
export const DOING_EVENT = "pty:doing";

/** What is running in a session, as far as its own screen says. */
export type Doing =
  /** Waiting to be typed at: a shell standing at its prompt. */
  | "idle"
  /** Running something, whatever it is. */
  | "running"
  /** Running one of the coding agents and waiting for the person: a session
   *  rather than a wait. */
  | "agent"
  /** The same session, with the agent answering rather than waiting. */
  | "working";

/** A session, and what it is doing. */
export type Doings = {
  id: string;
  doing: Doing;
};

/**
 * What every running session is doing, for a window that has just come up.
 *
 * The event carries the moments these change; a window that only listened would
 * draw nothing until a session next said something, which for a shell sitting
 * at its prompt is never.
 */
export function doingNow(): Promise<Doings[]> {
  return invoke<Doings[]>("pty_doing");
}

/** Follows the sessions as they turn from one of these to another. */
export function onDoing(next: (doings: Doings) => void): Promise<UnlistenFn> {
  return listen<Doings>(DOING_EVENT, (event) => next(event.payload));
}

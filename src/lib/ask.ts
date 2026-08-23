/**
 * What a session is asking, and the answer going back.
 *
 * The agents stop and ask — may I run this, may I write that, which of these
 * did you mean — and a question is not output: it is a turn. Nothing else
 * happens in that session until somebody takes it. The terminal is only where
 * it happens to be drawn, so the question is carried to the window as a
 * question rather than as a picture of one, and the graph can both show it and
 * answer it without the panel ever being opened.
 *
 * Read off the session's own screen by the Rust side — see `ask/mod.rs` there
 * for the reading itself, and `ask/watch.rs` for what holds a screen per
 * session and answers for it. Everything here is the shape it hands over.
 *
 * All of it is derived, which is worth knowing here too: the questions are
 * worked out from what the sessions have said, so that side can throw the
 * whole lot away and take it again without anything the window is holding
 * going stale. What the window has to do about that is nothing.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** Carries what a session is asking, and its going away again. */
export const ASK_EVENT = "pty:ask";

/** One of the numbered answers, as the agent itself offered it. */
export type Choice = {
  /** What is typed to take it, which is the number the agent printed. */
  key: string;
  label: string;
  /** Where the agent's own cursor is standing. */
  selected: boolean;
};

/** One question, as it can be answered from the graph. */
export type Ask = {
  /**
   * Which question this is, read off the question itself.
   *
   * What an answer is addressed to: a card is drawn from a reading that is
   * already a moment old, and an answer meant for "may I delete this" must
   * never arrive at whatever the agent went on to ask instead. This goes back
   * with the answer and the session refuses it if the question has moved on.
   *
   * Taken from what the question says rather than from a count, so the same
   * box is the same question whenever it is read. Nothing here does anything
   * with it but hand it back.
   */
  seq: number;
  /** What the question is about: the tool, the command, the file. */
  detail: string[];
  question: string;
  choices: Choice[];
};

/** A session, and what it is asking — or, with nothing in it, that it stopped. */
export type Asking = {
  id: string;
  ask: Ask | null;
};

/**
 * Every question standing right now, for a window that has just come up.
 *
 * The event carries these from moment to moment; this is the first look. A
 * window that only listened would show nothing until an agent next redrew,
 * which for a session sitting on a question is never.
 */
export function askingNow(): Promise<Asking[]> {
  return invoke("pty_asking");
}

/**
 * Answers one, by typing at the session what takes that answer.
 *
 * The question's own number goes with it, and the session refuses an answer
 * that is no longer the question being asked.
 */
export function answerAsk(id: string, seq: number, key: string): Promise<void> {
  return invoke("pty_answer", { id, seq, key });
}

export function onAsking(next: (asking: Asking) => void): Promise<UnlistenFn> {
  return listen<Asking>(ASK_EVENT, (event) => next(event.payload));
}

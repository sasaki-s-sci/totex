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
 * Read off the session's own screen by the Rust side — see `ask.rs` there,
 * which is where the whole of the reading lives. Everything here is the shape
 * it hands over.
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
   * Which question this is, counted through the life of the session.
   *
   * What an answer is addressed to: a card is drawn from a reading that is
   * already a moment old, and an answer meant for "may I delete this" must
   * never arrive at whatever the agent went on to ask instead. The number goes
   * back with the answer and the session refuses it if the question has moved
   * on.
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

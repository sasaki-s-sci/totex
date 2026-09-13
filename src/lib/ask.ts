import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export const ASK_EVENT = "pty:ask";

export type Taking = "key" | "line" | "walk" | "words";

export type Choice = {
  key: string;
  label: string;
  selected: boolean;
  picked: boolean;
};

export type Ask = {
  /**
   * Derived from the question text, not a counter: an answer carries it and the session refuses one
   * for a question that moved on.
   */
  seq: number;
  detail: string[];
  question: string;
  taking: Taking;
  /** Every key only picks up; `takeAsk` sends the return that answers. */
  picking: boolean;
  writing: boolean;
  choices: Choice[];
};

export type Asking = {
  id: string;
  ask: Ask | null;
};

export function askingNow(): Promise<Asking[]> {
  return invoke("pty_asking");
}

export function answerAsk(id: string, seq: number, key: string): Promise<void> {
  return invoke("pty_answer", { id, seq, key });
}

export function replyAsk(id: string, seq: number, text: string): Promise<void> {
  return invoke("pty_reply", { id, seq, text });
}

export function pointAsk(id: string, seq: number, key: string): Promise<void> {
  return invoke("pty_point", { id, seq, key });
}

export function pickAsk(id: string, seq: number, key: string): Promise<void> {
  return invoke("pty_pick", { id, seq, key });
}

export function takeAsk(id: string, seq: number): Promise<void> {
  return invoke("pty_take", { id, seq });
}

export function onAsking(next: (asking: Asking) => void): Promise<UnlistenFn> {
  return listen<Asking>(ASK_EVENT, (event) => next(event.payload));
}

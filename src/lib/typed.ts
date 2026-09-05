/**
 * The last thing typed at a session.
 *
 * Read off the session's own screen by the Rust side — see `ask/typed` there,
 * and `ask/watch` for what holds a screen per session and keeps the last one it
 * read. A command a shell was given and a turn an agent was handed are the same
 * thing to a terminal, and this is that thing: one line, whatever it was that
 * somebody typed.
 *
 * Polled while labels are visible. Open terminals and keyboard navigation use
 * a fast interval; unchanged readings do not trigger another canvas render.
 */

import { invoke } from "@tauri-apps/api/core";

/** A session, and the last thing typed at it. */
export type Typed = {
  id: string;
  said: string;
};

/**
 * The last thing typed at every running session that has been typed at.
 *
 * A session nobody has typed anything into is not in here at all — a shell
 * opened and left alone, or one whose whole conversation was already off the
 * screen when this window came up and rebuilt what it could from the backlogs.
 */
export function typedNow(): Promise<Typed[]> {
  return invoke<Typed[]>("pty_typed");
}

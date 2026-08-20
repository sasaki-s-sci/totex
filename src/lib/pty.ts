/**
 * The process behind a `cli` session.
 *
 * A session is a process, not a panel. It is started when it is opened, it
 * carries on while the window is showing something else, and it is only ever
 * ended on purpose — so everything about it lives here rather than inside the
 * terminal that happens to be drawing it. A terminal is built against a session
 * that is already running, and is handed what it has missed.
 */

import { invoke } from "@tauri-apps/api/core";

import { agentOf } from "./agents";
import type { Session } from "./session";

/** Carries a run of a session's output. */
export const DATA_EVENT = "pty:data";
/** Carries the session that has ended. */
export const EXIT_EVENT = "pty:exit";

/** A run of what a session said. */
export type Said = {
  id: string;
  data: string;
  /**
   * How much the session had said before this run.
   *
   * What it is for is the moment a terminal attaches: it is listening before it
   * asks for the backlog, so a run that lands between the two arrives twice —
   * once live and once inside the text — and this is which.
   */
  seq: number;
};

/** Everything a session has said that is still kept. */
export type Held = {
  text: string;
  /** How far the text reaches into everything the session has said. */
  upto: number;
};

/**
 * The size a session is started at, before anything has measured a terminal.
 *
 * The eighty columns every terminal has had since they were furniture. Nothing
 * is drawn at it for longer than it takes the panel to build a terminal and say
 * what room it really has — and a session nobody ever looks at is a shell whose
 * width was never anybody's business.
 */
const ROWS = 24;
const COLS = 80;

/** The sessions this window has started, so that starting one twice is once. */
const started = new Map<string, Promise<void>>();

/**
 * Starts the process behind a session, or waits for the one already starting.
 *
 * Called when the session is opened and again by whatever draws it, which is
 * the point: neither has to know whether it is the first. A shell that would
 * not start is forgotten rather than remembered as started, so the terminal
 * that asks next tries again — and is the one that goes red when it fails.
 *
 * Whatever the session was opened for is typed here too. It belongs with the
 * start and not with the drawing: a session opened with an agent is running
 * that agent from the moment it exists, whether or not the panel got as far as
 * building a terminal for it.
 */
export function startShell(session: Session): Promise<void> {
  const already = started.get(session.id);
  if (already) return already;

  const starting = invoke<void>("pty_open", {
    id: session.id,
    cwd: session.cwd,
    rows: ROWS,
    cols: COLS,
  })
    .then(async () => {
      // Typed rather than run for us: the shell reads it when it is ready, it
      // is echoed the way anything typed is, and a rerun is one arrow key away
      // in the shell's own history. A session opened with something to do
      // carries that with it, as the agent's own first argument — the quoting
      // is the Rust side's, which is the half that knows what shell is at the
      // other end.
      if (!session.agent) return;
      const argv = agentOf(session.agent).start(session.opening ?? null);
      await invoke<void>("pty_run", { id: session.id, argv });
    })
    .catch((cause) => {
      started.delete(session.id);
      throw cause;
    });

  started.set(session.id, starting);
  return starting;
}

/**
 * Everything a session has said so far, for a terminal that has just been built
 * for it.
 *
 * Null when there is nothing to attach to: the session ended between being
 * started and being drawn.
 */
export function attachShell(id: string): Promise<Held | null> {
  return invoke<Held | null>("pty_attach", { id });
}

/** Sends what was typed. Keystrokes, not lines: the shell does the editing. */
export function writeShell(id: string, data: string): Promise<void> {
  return invoke<void>("pty_write", { id, data });
}

/** Tells the shell how much room the terminal drawing it actually has. */
export function resizeShell(id: string, rows: number, cols: number): Promise<void> {
  return invoke<void>("pty_resize", { id, rows, cols });
}

/** Ends it. The one thing here that is not undone by asking again. */
export function endShell(id: string): Promise<void> {
  started.delete(id);
  return invoke<void>("pty_close", { id });
}

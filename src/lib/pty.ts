/**
 * The process behind a session.
 *
 * A session is a process, not a panel. It is started when it is opened, it
 * carries on while the window is showing something else, and it is only ever
 * ended on purpose — so everything about it lives here rather than inside the
 * terminal that happens to be drawing it. A terminal is built against a session
 * that is already running, and is handed what it has missed.
 */

import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { type Session, sessionMeta } from "./session";

/** Carries a run of a session's output. */
export const DATA_EVENT = "pty:data";
/** Carries the session that has ended. */
export const EXIT_EVENT = "pty:exit";

/** A session ending invalidates every reading held for it. */
export function onShellExit(receive: (id: string) => void): Promise<() => void> {
  return listen<string>(EXIT_EVENT, (event) => receive(event.payload));
}

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

/**
 * One session that is still running, as the window finds it again.
 *
 * A session is a process, so what is running has only ever been true where the
 * processes are: a window keeping its own list was keeping a copy, and a copy
 * is exactly what is lost when the window is reloaded or replaced. So the list
 * is asked for instead — see `restored`, which is what turns these back into
 * sessions.
 */
export type Running = {
  id: string;
  cwd: string;
  /**
   * The size the shell is being run at.
   *
   * Not read here. A terminal built for this session measures itself and says
   * what room it really has; this is for whatever has to rebuild a screen the
   * session drew, which has to do it at the width it was drawn at.
   */
  rows: number;
  cols: number;
  /** What the window left beside it, handed back exactly as it was left. */
  meta: string | null;
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
 * A shell and nothing else. What is to be run in it is typed into it, by
 * whoever opened it, the way it would be in any other terminal.
 */
export function startShell(session: Session): Promise<void> {
  const already = started.get(session.id);
  if (already) return already;

  const starting = invoke<void>("pty_open", {
    id: session.id,
    cwd: session.cwd,
    rows: ROWS,
    cols: COLS,
    // Kept beside the process and never read there, so that a window which has
    // forgotten this session can be handed back everything it knew about it.
    meta: sessionMeta(session),
  }).catch((cause) => {
    started.delete(session.id);
    throw cause;
  });

  started.set(session.id, starting);
  return starting;
}

/**
 * Every session that is still running, whoever started it.
 *
 * What a window asks for when it comes up: its own sessions from before it was
 * reloaded, and one day the ones it was never the window for. Nothing here is
 * the same thing as opening one — these are already running, and this is only
 * finding out about them.
 */
export function runningShells(): Promise<Running[]> {
  return invoke<Running[]>("pty_sessions");
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

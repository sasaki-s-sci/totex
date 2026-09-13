import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

import { reserveSessionIds, type Session, sessionMeta } from "./session";

export const DATA_EVENT = "pty:data";
export const EXIT_EVENT = "pty:exit";

export function onShellExit(receive: (id: string) => void): Promise<() => void> {
  return listen<string>(EXIT_EVENT, (event) => receive(event.payload));
}

export type Said = {
  id: string;
  data: string;
  /**
   * A terminal listens before asking for the backlog, so a run landing between arrives twice; `seq`
   * against `upto` says which.
   */
  seq: number;
};

export type Running = {
  id: string;
  cwd: string;
  rows: number;
  cols: number;
  meta: string | null;
};

export type Held = {
  text: string;
  upto: number;
};

const ROWS = 24;
const COLS = 80;

const started = new Map<string, Promise<void>>();

export function resumeShells(sessions: readonly Session[]): void {
  reserveSessionIds(sessions);
  for (const session of sessions) {
    if (!started.has(session.id)) started.set(session.id, Promise.resolve());
  }
}

/**
 * Called by the opener and by every terminal; a failed start is forgotten so the next asks again.
 */
export function startShell(session: Session): Promise<void> {
  const already = started.get(session.id);
  if (already) return already;

  const starting = invoke<void>("pty_open", {
    id: session.id,
    cwd: session.cwd,
    rows: ROWS,
    cols: COLS,
    // Kept beside the process unread, so a window that forgot the session gets it back.
    meta: sessionMeta(session),
  }).catch((cause) => {
    started.delete(session.id);
    throw cause;
  });

  started.set(session.id, starting);
  return starting;
}

export function runningShells(): Promise<Running[]> {
  return invoke<Running[]>("pty_sessions");
}

export function attachShell(id: string): Promise<Held | null> {
  return invoke<Held | null>("pty_attach", { id });
}

export function writeShell(id: string, data: string): Promise<void> {
  return invoke<void>("pty_write", { id, data });
}

export function resizeShell(id: string, rows: number, cols: number): Promise<void> {
  return invoke<void>("pty_resize", { id, rows, cols });
}

export function endShell(id: string): Promise<void> {
  started.delete(id);
  return invoke<void>("pty_close", { id });
}

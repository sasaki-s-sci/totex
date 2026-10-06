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
const ended = new Set<string>();

export function shellEnded(id: string): boolean {
  return ended.has(id);
}

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
  if (ended.has(session.id)) return Promise.reject(new Error("terminal has ended"));
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

type Batch = { data: string; done: Promise<void>; settle: (sent: Promise<void>) => void };

/** Per session: whether a write is in flight, and what was typed while it was. */
const typing = new Map<string, Batch | null>();

/**
 * One write in flight per session, and whatever is typed meanwhile goes together as the next.
 * Separate invokes run concurrently on the host and can land out of order; gathering keeps the
 * order without a round trip per key.
 */
export function writeShell(id: string, data: string): Promise<void> {
  if (!typing.has(id)) {
    typing.set(id, null);
    return send(id, data);
  }
  let held = typing.get(id);
  if (!held) {
    let settle: Batch["settle"] = () => undefined;
    const done = new Promise<void>((resolve, reject) => {
      settle = (sent) => sent.then(resolve, reject);
    });
    held = { data: "", done, settle };
    typing.set(id, held);
  }
  held.data += data;
  return held.done;
}

function send(id: string, data: string): Promise<void> {
  const sent = invoke<void>("pty_write", { id, data });
  void sent
    .catch(() => undefined)
    .then(() => {
      const held = typing.get(id);
      if (!held) {
        typing.delete(id);
        return;
      }
      typing.set(id, null);
      held.settle(send(id, held.data));
    });
  return sent;
}

export function resizeShell(id: string, rows: number, cols: number): Promise<void> {
  return invoke<void>("pty_resize", { id, rows, cols });
}

export async function endShell(id: string): Promise<void> {
  // A close must follow an in-flight open, or the terminal could appear after deletion.
  const starting = started.get(id);
  ended.add(id);
  started.delete(id);
  if (starting) await starting.catch(() => undefined);
  try {
    await invoke<void>("pty_close", { id });
  } catch (cause) {
    ended.delete(id);
    if (starting) started.set(id, starting);
    throw cause;
  }
}

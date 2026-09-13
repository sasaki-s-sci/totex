import type { Running } from "./pty";

export type Session = {
  /**
   * Not derived from the directory: a branch's button pressed again starts another session beside
   * the first.
   */
  id: string;
  cwd: string;
  branch: string;
};

let started = 0;

/** Opaque to the side that holds it, so a field can be added without changing anything there. */
type Kept = {
  branch: string;
};

export function sessionMeta(session: Session): string {
  return JSON.stringify({ branch: session.branch } satisfies Kept);
}

const ORDINAL = / cli (\d+)$/;

export function reserveSessionIds(sessions: readonly { id: string }[]): void {
  for (const session of sessions) {
    started = Math.max(started, Number(ORDINAL.exec(session.id)?.[1] ?? 0));
  }
}

/**
 * The counter must clear every running id first, else a fresh session would be named after a live
 * one.
 */
export function restored(running: readonly Running[]): Session[] {
  reserveSessionIds(running);
  return running.map((shell) => {
    return { id: shell.id, cwd: shell.cwd, branch: branchOf(shell.meta) };
  });
}

function branchOf(meta: string | null): string {
  if (!meta) return "";
  try {
    return (JSON.parse(meta) as Partial<Kept>).branch ?? "";
  } catch {
    return "";
  }
}

/** The directory is in the id so it reads in logs and process tables. */
export function sessionId(cwd: string): string {
  started += 1;
  return `${cwd} cli ${started}`;
}

export function shellSession(cwd: string, branch: string): Session {
  return { id: sessionId(cwd), cwd, branch };
}

/** By directory, not branch name: a branch can rename itself under a running session. */
export function ordinalOf(sessions: readonly Session[], session: Session): number | null {
  const alike = sessions.filter((other) => other.cwd === session.cwd);
  return alike.length > 1 ? alike.indexOf(session) + 1 : null;
}

import type { Running } from "./pty";

export type Session = {
  /**
   * Not derived from the directory: a branch's button pressed again starts another session beside
   * the first.
   */
  id: string;
  cwd: string;
  branch: string;
  /**
   * Opened from a folder's row rather than a branch: the directory may be a repository's too, and
   * the terminal stands by the row that opened it.
   */
  folder?: boolean;
};

let started = 0;

/** Opaque to the side that holds it, so a field can be added without changing anything there. */
type Kept = {
  branch: string;
  folder?: boolean;
};

export function sessionMeta(session: Session): string {
  return JSON.stringify({
    branch: session.branch,
    ...(session.folder ? { folder: true } : null),
  } satisfies Kept);
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
    return { id: shell.id, cwd: shell.cwd, ...kept(shell.meta) };
  });
}

function kept(meta: string | null): Pick<Session, "branch" | "folder"> {
  if (!meta) return { branch: "" };
  try {
    const { branch, folder } = JSON.parse(meta) as Partial<Kept>;
    return { branch: branch ?? "", ...(folder === true ? { folder: true } : null) };
  } catch {
    return { branch: "" };
  }
}

/** The directory is in the id so it reads in logs and process tables. */
export function sessionId(cwd: string): string {
  started += 1;
  return `${cwd} cli ${started}`;
}

export function shellSession(cwd: string, branch: string, folder = false): Session {
  return { id: sessionId(cwd), cwd, branch, ...(folder ? { folder: true } : null) };
}

/** By directory, not branch name: a branch can rename itself under a running session. */
export function ordinalOf(sessions: readonly Session[], session: Session): number | null {
  const alike = sessions.filter((other) => other.cwd === session.cwd);
  return alike.length > 1 ? alike.indexOf(session) + 1 : null;
}

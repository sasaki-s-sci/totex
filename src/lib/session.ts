/**
 * One terminal, running in a directory.
 *
 * A session outlives the panel that shows it: it is drawn on the graph, in the
 * column of what is running, and stays there until it is ended. Closing the
 * panel only puts it away.
 *
 * Always a directory, never a branch name: by the time a session exists the
 * branch has its worktree, everything it does happens in there, and the
 * directory is what the graph joins it to — a worktree's row, a repository
 * folded into one mark, or the folder itself.
 *
 * Nothing here knows what is being run inside it. A terminal is a shell, and
 * what somebody types into it — an agent, a build, an editor — is theirs. The
 * window opened this one and can end it, and that is the whole of what it
 * claims to know.
 */
import type { Running } from "./pty";

export type Session = {
  /**
   * This instance and no other.
   *
   * Not derived from the directory: pressing a branch's button again starts
   * another one beside the first, as many as are wanted, and each has its own
   * process at the other end of this id.
   */
  id: string;
  cwd: string;
  /** The branch the directory belongs to, which is the row it is drawn on. */
  branch: string;
};

/** Counts the sessions this window has started, which is what tells them apart. */
let started = 0;

/**
 * What the window wants kept beside a session while it is running.
 *
 * Everything the window knows about a session that the process itself does not:
 * the id and the directory belong to the process, and this is the rest. It is
 * written and read here and nowhere else — the side that holds it treats it as
 * a string it never opens, which is what lets this grow a field without
 * anything there changing.
 */
type Kept = {
  branch: string;
};

/** The window's half of a session, to be handed back with it. */
export function sessionMeta(session: Session): string {
  return JSON.stringify({ branch: session.branch } satisfies Kept);
}

/** How a session's id ends, which is what makes two in one directory two. */
const ORDINAL = / cli (\d+)$/;

/**
 * The sessions a window comes back to, out of the processes still running.
 *
 * What this is for is a window that has been reloaded — and, one day, a window
 * whose whole backend was replaced underneath it while the shells carried on.
 * Neither is a window that opened these: it is being told what is running and
 * building its own half of each one back out of what it left beside it.
 *
 * A session whose meta cannot be read is still a session. It is kept, because
 * it is a live process somebody has to be able to see and end, even if the
 * graph no longer has a row it belongs on.
 */
export function restored(running: readonly Running[]): Session[] {
  return running.map((shell) => {
    // The count has to clear everything already running before the next session
    // is named. A window that has just come up would otherwise name its first
    // session after one that is still there — and opening that one is not an
    // error, it is quietly being handed the shell somebody is already in.
    const ordinal = Number(ORDINAL.exec(shell.id)?.[1] ?? 0);
    if (ordinal > started) started = ordinal;
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

/**
 * A fresh id, readable at the other end.
 *
 * The directory is in it because these ids turn up in logs and in the process
 * table, where `…/repo cli 3` says what is running and `7f3a-…` does not; the
 * number after it is what makes it this one.
 */
export function sessionId(cwd: string): string {
  started += 1;
  return `${cwd} cli ${started}`;
}

/** A terminal in a directory, which is all a session is. */
export function shellSession(cwd: string, branch: string): Session {
  return { id: sessionId(cwd), cwd, branch };
}

/**
 * Which of the sessions running in a directory this one is, counting from one —
 * or null when it is the only one there.
 *
 * Two terminals in the same worktree are two terminals; nothing about either of
 * them says which is which, so they are numbered. One on its own needs no
 * number, and does not get one.
 *
 * By directory rather than by branch name, for the same reason the session
 * carries one: the name of the branch checked out in there can change under a
 * running session — that is the whole point of a branch that names itself — and
 * the directory cannot.
 */
export function ordinalOf(sessions: readonly Session[], session: Session): number | null {
  const alike = sessions.filter((other) => other.cwd === session.cwd);
  return alike.length > 1 ? alike.indexOf(session) + 1 : null;
}

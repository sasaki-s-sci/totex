import type { AgentId } from "./agents";

/** Where something opened from a branch is shown. */
export type Surface = "chat" | "cli";

/**
 * One shell or agent, running in a directory.
 *
 * A session outlives the panel that shows it: it is drawn on the graph, in the
 * column of what is running, and stays there until it is ended. Closing the
 * panel only puts it away.
 *
 * Always a directory, never a branch name: by the time a session exists the
 * branch has its worktree, everything it does happens in there, and the
 * directory is what the graph joins it to — a worktree's row, a repository
 * folded into one mark, or the folder itself.
 */
export type Session = {
  /**
   * This instance and no other.
   *
   * Not derived from the directory or the agent: pressing a branch's button
   * again starts another one beside the first, as many as are wanted, and each
   * has its own process at the other end of this id.
   */
  id: string;
  cwd: string;
  /** The branch the directory belongs to, which is the row it is drawn on. */
  branch: string;
  surface: Surface;
  /** null for a plain shell. */
  agent: AgentId | null;
  /**
   * The first thing to say, for a session that was opened with something to do.
   *
   * Sent once, by whichever surface is showing it, as soon as it is up. What
   * comes back is a conversation like any other — this is only how it starts.
   */
  opening?: string;
};

/** Counts the sessions this window has started, which is what tells them apart. */
let started = 0;

/**
 * A fresh id, readable at the other end.
 *
 * The directory and the agent are in it because these ids turn up in logs and
 * in the process table, where `…/repo cli claude 3` says what is running and
 * `7f3a-…` does not; the number after them is what makes it this one.
 */
export function sessionId(cwd: string, surface: Surface, agent: AgentId | null): string {
  started += 1;
  return `${cwd} ${surface} ${agent ?? "shell"} ${started}`;
}

/** A plain shell in a directory, which is all a session is placed by. */
export function shellSession(cwd: string, branch: string): Session {
  return {
    id: sessionId(cwd, "cli", null),
    cwd,
    branch,
    surface: "cli",
    agent: null,
  };
}

/**
 * Which of the same-kind sessions running in a directory this one is, counting
 * from one — or null when it is the only one of its kind there.
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
  const alike = sessions.filter(
    (other) =>
      other.cwd === session.cwd &&
      other.surface === session.surface &&
      other.agent === session.agent,
  );
  return alike.length > 1 ? alike.indexOf(session) + 1 : null;
}

import { useCallback, useEffect, useMemo, useState } from "react";

import { endShell, runningShells, startShell } from "../lib/pty";
import { restored, type Session } from "../lib/session";

/**
 * Everything that is running, and which one the panel is showing.
 *
 * A session is a process. It stays until it is ended — whether or not anybody
 * is looking at it — so this list is what the graph draws its chips from, and
 * the panel only ever picks one of them out. Every rule about that lives here:
 * the window itself opens and ends sessions, and asks nothing about how.
 */
export function useSessions() {
  const [sessions, setSessions] = useState<readonly Session[]>([]);
  const [showing, setShowing] = useState<string | null>(null);

  // What was already running when this window came up. A session is a process
  // and outlives whatever is drawing it, so a window that starts with an empty
  // list is a window that has lost sight of live shells — its own, from before
  // it was reloaded, or ones it was never the window for. None of them is shown
  // by this: they are put back on the graph, and the panel is left where it was.
  useEffect(() => {
    let alive = true;
    runningShells()
      .then((running) => {
        if (!alive) return;
        setSessions((current) => {
          const known = new Set(current.map((session) => session.id));
          // Anything opened while this was in flight is this window's own and
          // is already where it belongs; what came back is older than all of it.
          const found = restored(running).filter((session) => !known.has(session.id));
          return found.length === 0 ? current : [...found, ...current];
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  /** Stops the process behind a session, and says when it is stopped. */
  const kill = useCallback((going: Session): Promise<unknown> => {
    return endShell(going.id).catch(() => undefined);
  }, []);

  /**
   * Starts one, and shows it.
   *
   * Always another one: pressing a branch's button again gives that branch a
   * second terminal, not the first one back. Two of them in the same directory
   * is the point — one running something long while the next is used for
   * everything else — so nothing here dedupes them.
   */
  const open = useCallback((next: Session) => {
    // Started here, with the session, and not by whatever draws it: a session
    // is a process, so it is running from the moment it exists — before the
    // panel has built a terminal for it, while the panel is showing something
    // else, and whether or not anybody ever looks at it. What it says in the
    // meantime is kept for whichever terminal asks. A failure has nothing to
    // say here; the terminal is where it is answered, and it asks again.
    void startShell(next).catch(() => undefined);
    setSessions((current) => [...current, next]);
    setShowing(next.id);
  }, []);

  /** Puts one in the panel, or puts the panel away when it is already there. */
  const show = useCallback((next: Session) => {
    setShowing((current) => (current === next.id ? null : next.id));
  }, []);

  /** Ends a session: the process stops, and it leaves the graph with it. */
  const end = useCallback(
    (going: Session) => {
      void kill(going);
      setSessions((current) => current.filter((session) => session.id !== going.id));
      setShowing((current) => (current === going.id ? null : current));
    },
    [kill],
  );

  /**
   * Ends everything running in a directory, and waits for it.
   *
   * What makes a worktree removable: the directory cannot be taken out from
   * under a live process, so the processes go first — and the answer only comes
   * back once they are actually gone, because what happens next is `git worktree
   * remove` on the very directory they were in.
   */
  const endIn = useCallback(
    async (cwd: string) => {
      const going = sessions.filter((session) => session.cwd === cwd);
      if (going.length === 0) return;
      await Promise.all(going.map(kill));
      setSessions((current) => current.filter((session) => session.cwd !== cwd));
      setShowing((current) => (going.some((session) => session.id === current) ? null : current));
    },
    [kill, sessions],
  );

  /** Every directory something is running in, which is what makes a worktree
   *  unsafe to throw away. */
  const attached = useMemo(() => sessions.map((session) => session.cwd), [sessions]);

  return { sessions, showing, attached, open, show, end, endIn };
}

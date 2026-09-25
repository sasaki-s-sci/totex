import { useCallback, useEffect, useMemo } from "react";
import { endShell, resumeShells, runningShells, startShell } from "../lib/pty";
import { restored, type Session } from "../lib/session";
import { frontValue, useFrontState } from "../shell/state";

resumeShells(frontValue<readonly Session[]>("sessions.list") ?? []);

export function useSessions() {
  const [sessions, setSessions] = useFrontState<readonly Session[]>("sessions.list", []);
  const [showing, setShowing] = useFrontState<string | null>("sessions.showing", null);
  // A terminal has one view; this records which host owns it.
  const [paged, setPaged] = useFrontState<readonly string[]>("sessions.paged", []);

  // Sessions outlive the window: pick up shells still running from before a reload.
  useEffect(() => {
    let alive = true;
    runningShells()
      .then((running) => {
        if (!alive) return;
        setSessions((current) => {
          const known = new Set(current.map((session) => session.id));
          // Anything opened while this was in flight is newer than what came back.
          const found = restored(running).filter((session) => !known.has(session.id));
          return found.length === 0 ? current : [...found, ...current];
        });
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const kill = useCallback((going: Session): Promise<unknown> => {
    return endShell(going.id).catch(() => undefined);
  }, []);

  // `below` puts it straight after that terminal, wherever it stands; otherwise it goes last.
  const open = useCallback((next: Session, below?: string) => {
    // Started with the session, not by whatever draws it; the terminal retries and reports a
    // failure.
    void startShell(next).catch(() => undefined);
    setSessions((current) => {
      const at = current.findIndex((session) => session.id === below);
      return at < 0
        ? [...current, next]
        : [...current.slice(0, at + 1), next, ...current.slice(at + 1)];
    });
    setShowing(next.id);
  }, []);

  const show = useCallback((next: Session) => {
    setPaged((current) => current.filter((id) => id !== next.id));
    setShowing((current) => (current === next.id ? null : next.id));
  }, []);

  // Not the toggle: a jump names its terminal and must never close the panel.
  const jump = useCallback((next: Session) => {
    setPaged((current) => current.filter((id) => id !== next.id));
    setShowing(next.id);
  }, []);

  // The panel's own close: the terminal stays open, only put away.
  const hide = useCallback(() => {
    setShowing(null);
  }, []);

  const page = useCallback((next: Session) => {
    setPaged((current) => (current.includes(next.id) ? current : [...current, next.id]));
    setShowing(null);
  }, []);

  const dock = useCallback((next: Session) => {
    setPaged((current) => current.filter((id) => id !== next.id));
    setShowing(next.id);
  }, []);

  const end = useCallback(
    (going: Session) => {
      void kill(going);
      setSessions((current) => current.filter((session) => session.id !== going.id));
      setPaged((current) => current.filter((id) => id !== going.id));
      setShowing((current) => (current === going.id ? null : current));
    },
    [kill],
  );

  // Waits until the processes are gone: `git worktree remove` follows on that directory.
  const endIn = useCallback(
    async (cwd: string) => {
      const going = sessions.filter((session) => session.cwd === cwd);
      if (going.length === 0) return;
      await Promise.all(going.map(kill));
      setSessions((current) => current.filter((session) => session.cwd !== cwd));
      setPaged((current) => current.filter((id) => going.every((session) => session.id !== id)));
      setShowing((current) => (going.some((session) => session.id === current) ? null : current));
    },
    [kill, sessions],
  );

  const attached = useMemo(() => sessions.map((session) => session.cwd), [sessions]);

  return { sessions, showing, paged, attached, open, show, jump, hide, page, dock, end, endIn };
}

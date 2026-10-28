import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { endShell, resumeShells, runningShells, shellEnded, startShell } from "../lib/pty";
import { restored, type Session } from "../lib/session";
import { terminalPageId } from "../page/placement";
import { closing, dismiss } from "../resume/runtime";
import { frontValue, useFrontState } from "../shell/state";

resumeShells(frontValue<readonly Session[]>("sessions.list") ?? []);

export function useSessions() {
  const [sessions, setSessions] = useFrontState<readonly Session[]>("sessions.list", []);
  const [sidebarSession, setShowing] = useFrontState<string | null>("sessions.showing", null);
  const [split, setSplit] = useFrontState<string | null>("pages.lowerSidebar", null);
  const [selected, select] = useFrontState<string | null>("sessions.active", null);
  const [activePlace, setActivePlace] = useState<"cards" | "sidebar">("cards");
  // Sessions absent from this list are available in the sidebar viewer.
  const [paged, setPaged] = useFrontState<readonly string[]>("sessions.paged", () =>
    sessions.map((session) => session.id),
  );
  const showing =
    sidebarSession !== null && !paged.includes(sidebarSession) ? sidebarSession : null;
  const currentSessions = useRef(sessions);
  currentSessions.current = sessions;

  const lower =
    showing === null
      ? undefined
      : sessions.find(
          (session) =>
            session.id !== showing &&
            terminalPageId(session.id) === split &&
            !paged.includes(session.id),
        );
  const active =
    selected !== null && sessions.some((session) => session.id === selected) ? selected : showing;

  // Sessions outlive the window: pick up shells still running from before a reload.
  useEffect(() => {
    let alive = true;
    runningShells()
      .then((running) => {
        if (!alive) return;
        const known = new Set(currentSessions.current.map((session) => session.id));
        // Anything opened while this was in flight is newer than what came back.
        const found = restored(running).filter(
          (session) => !known.has(session.id) && !shellEnded(session.id),
        );
        if (!found.length) return;
        setPaged((current) => [...new Set([...current, ...found.map((session) => session.id)])]);
        setSessions((current) => [
          ...found.filter((session) => !current.some((held) => held.id === session.id)),
          ...current,
        ]);
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
    setPaged((current) => [...current, next.id]);
    setActivePlace("cards");
    select(next.id);
  }, []);

  // A terminal put back after it was lost, where it stood, without taking the panel from anything.
  const restore = useCallback((next: Session, asPage = true) => {
    void startShell(next).catch(() => undefined);
    if (asPage && !currentSessions.current.some((session) => session.id === next.id))
      setPaged((current) => (current.includes(next.id) ? current : [...current, next.id]));
    setSessions((current) =>
      current.some((session) => session.id === next.id) ? current : [...current, next],
    );
  }, []);

  // Keyboard navigation opens the sidebar; an existing split keeps its active pane.
  const jump = useCallback(
    (next: Session) => {
      setActivePlace("sidebar");
      setPaged((current) => current.filter((id) => id !== next.id));
      if (next.id !== showing && next.id !== lower?.id) {
        if (showing !== null && active === lower?.id) setSplit(terminalPageId(next.id));
        else setShowing(next.id);
      }
      select(next.id);
    },
    [showing, lower?.id, active],
  );

  // The panel's own close: the terminal stays open, only put away.
  const hide = useCallback(() => {
    setShowing(null);
    setSplit(null);
    setActivePlace("cards");
  }, []);

  const page = useCallback((next: Session) => {
    setPaged((current) => (current.includes(next.id) ? current : [...current, next.id]));
    setShowing((shown) => (shown === next.id ? null : shown));
    setSplit((held) => (held === terminalPageId(next.id) ? null : held));
    setActivePlace("cards");
    select(next.id);
  }, []);

  const dock = useCallback((next: Session) => {
    setPaged((current) => current.filter((id) => id !== next.id));
    setShowing(next.id);
    setActivePlace("sidebar");
    select(next.id);
  }, []);

  const end = useCallback(
    (going: Session) => {
      // Closed from the window: whatever totex started in it can be had back for a while.
      closing(going.id);
      void kill(going);
      setSessions((current) => current.filter((session) => session.id !== going.id));
      setPaged((current) => current.filter((id) => id !== going.id));
      if (going.id === showing) {
        setShowing(lower?.id ?? null);
        setSplit(null);
        select(lower?.id ?? null);
      } else if (going.id === lower?.id) {
        setSplit(null);
        select(showing);
      } else if (going.id === active) select(showing);
    },
    [kill, showing, lower?.id, active],
  );

  // Waits until the processes are gone: `git worktree remove` follows on that directory.
  const endIn = useCallback(
    async (cwd: string) => {
      const going = sessions.filter((session) => session.cwd === cwd);
      if (going.length === 0) return;
      // The directory is about to go, and the jobs in it with it.
      for (const session of going) dismiss(session.id);
      await Promise.all(going.map(kill));
      setSessions((current) => current.filter((session) => session.cwd !== cwd));
      setPaged((current) => current.filter((id) => going.every((session) => session.id !== id)));
      setShowing((current) => (going.some((session) => session.id === current) ? null : current));
    },
    [kill, sessions],
  );

  // Include native sessions that have no current graph or terminal view.
  const endMatching = useCallback(
    async (matches: (session: Session) => boolean) => {
      const native = restored(await runningShells());
      const all = new Map([...native, ...sessions].map((session) => [session.id, session]));
      const going = [...all.values()].filter(matches);
      // Taken off the canvas on purpose, which is not losing them.
      for (const session of going) dismiss(session.id);
      const results = await Promise.allSettled(going.map((session) => endShell(session.id)));
      const ended = new Set(
        going
          .filter((_, index) => results[index].status === "fulfilled")
          .map((session) => session.id),
      );
      setSessions((current) => current.filter((session) => !ended.has(session.id)));
      setPaged((current) => current.filter((id) => !ended.has(id)));
      setShowing((current) => (current !== null && ended.has(current) ? null : current));
      if (results.some((result) => result.status === "rejected"))
        throw new Error("terminal removal failed");
    },
    [sessions],
  );

  const attached = useMemo(() => sessions.map((session) => session.cwd), [sessions]);

  return {
    sessions,
    showing,
    active,
    activePlace,
    setActivePlace,
    select,
    split,
    setSplit,
    paged,
    attached,
    open,
    restore,
    jump,
    hide,
    page,
    dock,
    end,
    endIn,
    endMatching,
  };
}

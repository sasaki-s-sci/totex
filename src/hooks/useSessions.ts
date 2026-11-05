import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  endShell,
  resumeShells,
  runningShells,
  shellClosing,
  shellEnded,
  shellExited,
  startShell,
} from "../lib/pty";
import { orderSessions, restored, type Session } from "../lib/session";
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
  const [closeFailed, setCloseFailed] = useState(false);
  const clearCloseFailure = useCallback(() => setCloseFailed(false), []);
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
  const placement = useRef({ showing, lower: lower?.id, active });
  placement.current = { showing, lower: lower?.id, active };

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
    setActivePlace("sidebar");
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

  const dock = useCallback((next: Session, below = false) => {
    setPaged((current) => current.filter((id) => id !== next.id));
    if (below) setSplit(terminalPageId(next.id));
    else setShowing(next.id);
    setActivePlace("sidebar");
    select(next.id);
  }, []);

  const forget = useCallback((ended: ReadonlySet<string>) => {
    const { showing, lower, active } = placement.current;
    const remaining = (id: string | null | undefined) => (id && !ended.has(id) ? id : null);
    const next = remaining(showing) ?? remaining(lower);
    // Exit events may arrive together, before React renders the first removal.
    placement.current = {
      showing: showing && ended.has(showing) ? next : showing,
      lower: (showing && ended.has(showing)) || (lower && ended.has(lower)) ? undefined : lower,
      active: active && ended.has(active) ? next : active,
    };
    currentSessions.current = currentSessions.current.filter((session) => !ended.has(session.id));
    setSessions((current) => current.filter((session) => !ended.has(session.id)));
    setPaged((current) => current.filter((id) => !ended.has(id)));
    if (showing && ended.has(showing)) {
      setShowing(next);
      setSplit(null);
    } else if (lower && ended.has(lower)) setSplit(null);
    if (active && ended.has(active)) select(next);
  }, []);

  const end = useCallback(
    async (going: Session, exited = false): Promise<boolean> => {
      if (exited) {
        const requested = shellClosing(going.id);
        shellExited(going.id);
        if (requested) return true;
      } else {
        try {
          await endShell(going.id);
          closing(going.id);
          setCloseFailed(false);
        } catch {
          setCloseFailed(true);
          return false;
        }
      }
      forget(new Set([going.id]));
      return true;
    },
    [forget],
  );

  // Include native sessions that have no current graph or terminal view.
  const endMatching = useCallback(
    async (matches: (session: Session) => boolean) => {
      const native = restored(await runningShells());
      const all = new Map(
        [...native, ...currentSessions.current].map((session) => [session.id, session]),
      );
      const going = [...all.values()].filter(matches);
      const results = await Promise.allSettled(going.map((session) => endShell(session.id)));
      const ended = new Set(
        going
          .filter((_, index) => results[index].status === "fulfilled")
          .map((session) => session.id),
      );
      for (const id of ended) dismiss(id);
      forget(ended);
      if (results.some((result) => result.status === "rejected"))
        throw new Error("terminal removal failed");
    },
    [forget],
  );

  // Deleting a worktree must wait for confirmed termination, including unseen native sessions.
  const endIn = useCallback(
    (cwd: string) => endMatching((session) => session.cwd === cwd),
    [endMatching],
  );

  const attached = useMemo(() => sessions.map((session) => session.cwd), [sessions]);
  const reorder = useCallback((ids: readonly string[]) => {
    setSessions((current) => orderSessions(current, ids));
  }, []);

  return {
    sessions,
    reorder,
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
    hide,
    page,
    dock,
    end,
    endIn,
    endMatching,
    closeFailed,
    clearCloseFailure,
  };
}

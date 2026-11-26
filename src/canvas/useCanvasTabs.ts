import { useCallback, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import type { useSessions } from "../hooks/useSessions";
import { reserveSessionIds, type Session, shellSession } from "../lib/session";
import { useFrontState } from "../shell/state";
import type { useCanvases } from "./useCanvases";

export type CanvasTab = Pick<Session, "id" | "cwd" | "branch" | "folder"> & { terminal?: string };
export const canvasOf = (session: Session) => session.canvas ?? session.id;

export function useCanvasTabs(
  sessions: ReturnType<typeof useSessions>,
  canvas: ReturnType<typeof useCanvases>,
) {
  const [held, setTabs] = useFrontState<CanvasTab[]>("canvas.tabs", []);
  reserveSessionIds(held);
  const [selected, select] = useFrontState<string | null>("canvas.active", null);
  const tabs = useMemo(() => {
    const tabs = [...held];
    for (const session of sessions.sessions) {
      const id = canvasOf(session);
      if (!tabs.some((tab) => tab.id === id)) tabs.push({ ...session, id, terminal: session.id });
    }
    return tabs;
  }, [held, sessions.sessions]);
  const terminals = useMemo(
    () =>
      tabs.flatMap((tab) => sessions.sessions.filter((session) => canvasOf(session) === tab.id)),
    [tabs, sessions.sessions],
  );
  const activeSession = sessions.sessions.find((session) => session.id === sessions.active);
  const current =
    tabs.find((tab) => tab.id === selected) ??
    tabs.find((tab) => tab.id === (activeSession && canvasOf(activeSession))) ??
    tabs[0];
  const latest = useRef({ tabs, current });
  latest.current = { tabs, current };
  useEffect(() => {
    if (tabs.length !== held.length) setTabs(tabs);
    for (const tab of tabs) void canvas.open(tab.id, tab.cwd).catch(() => undefined);
  }, [held.length, tabs, canvas.open]);
  // Terminal selection from links and restored windows selects its owning tab too.
  useLayoutEffect(() => {
    if (!activeSession || !sessions.selected) return;
    const id = canvasOf(activeSession);
    select(id);
    setTabs((before) =>
      before.map((tab) => (tab.id === id ? { ...tab, terminal: activeSession.id } : tab)),
    );
  }, [activeSession, sessions.selected]);
  const pick = useCallback(
    (id: string, terminal?: string) => {
      const tab = latest.current.tabs.find((tab) => tab.id === id);
      if (!tab) return;
      select(id);
      const members = sessions.sessions.filter((session) => canvasOf(session) === id);
      const next =
        members.find((session) => session.id === (terminal ?? tab.terminal)) ?? members[0];
      if (next) sessions.dock(next);
      else {
        sessions.hide();
        sessions.select(null);
      }
    },
    [sessions.sessions, sessions.dock, sessions.hide, sessions.select],
  );
  const openTab = useCallback(
    (session: Session) => {
      const tab: CanvasTab = { ...session, terminal: session.id };
      setTabs((before) => [...before, tab]);
      select(tab.id);
      void canvas.open(tab.id, tab.cwd).catch(() => undefined);
      sessions.open({ ...session, canvas: tab.id });
      return tab.id;
    },
    [canvas.open, sessions.open],
  );
  const open = useCallback(
    (session: Session, below?: string) => {
      const tab = session.canvas
        ? latest.current.tabs.find((tab) => tab.id === session.canvas)
        : latest.current.current;
      if (!tab || tab.cwd !== session.cwd) return openTab(session);
      select(tab.id);
      sessions.open({ ...session, canvas: tab.id }, below);
      return tab.id;
    },
    [openTab, sessions.open],
  );
  const addTerminal = useCallback(
    (tab: CanvasTab) => {
      open({ ...shellSession(tab.cwd, tab.branch, tab.folder), canvas: tab.id });
    },
    [open],
  );
  const closing = useRef(new Set<string>());
  const close = useCallback(
    async (id: string) => {
      if (closing.current.has(id)) return;
      closing.current.add(id);
      try {
        if (!(await canvas.saveSession(id))) return;
        await sessions.endMatching((session) => canvasOf(session) === id);
        await canvas.close(id);
        const next = latest.current.tabs.filter((tab) => tab.id !== id);
        setTabs(next);
        if (latest.current.current?.id === id) {
          const at = latest.current.tabs.findIndex((tab) => tab.id === id);
          const following = next[Math.min(at, next.length - 1)];
          if (following) pick(following.id);
          else select(null);
        }
      } finally {
        closing.current.delete(id);
      }
    },
    [canvas.saveSession, canvas.close, sessions.endMatching, pick],
  );
  const endMatching = useCallback(
    async (matches: (session: Session) => boolean) => {
      const going = latest.current.tabs.filter(matches);
      for (const tab of going) {
        if (!(await canvas.saveSession(tab.id)))
          throw new Error("Save the edited files before removing this folder.");
      }
      await sessions.endMatching(matches);
      for (const tab of going) await canvas.close(tab.id);
      const ids = new Set(going.map((tab) => tab.id));
      setTabs((before) => before.filter((tab) => !ids.has(tab.id)));
      if (latest.current.current && ids.has(latest.current.current.id)) {
        const next = latest.current.tabs.find((tab) => !ids.has(tab.id));
        if (next) pick(next.id);
        else select(null);
      }
    },
    [canvas.saveSession, canvas.close, sessions.endMatching, pick],
  );
  return { tabs, terminals, current, pick, open, openTab, addTerminal, close, endMatching };
}

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { useSessions } from "../hooks/useSessions";
import { shellSession } from "../lib/session";
import { useFrontState } from "../shell/state";
import { type PagePlacement, placementOf, terminalPageId } from "./placement";

type Entry = { id: string; name: string };
type Workspace = {
  entries: readonly Entry[];
  showing: string | null;
  /** The sidebar's lower pane, when it is split; never the page showing above it. */
  lower: string | null;
  placement: (id: string) => PagePlacement;
  move: (id: string, to: PagePlacement) => void;
  show: (id: string) => void;
  hide: () => void;
  forget: (id: string) => void;
};

const WorkspaceContext = createContext<Workspace | null>(null);
const HostsContext = createContext<{
  hosts: ReadonlyMap<string, HTMLElement>;
  registerHost: (key: string, host: HTMLElement | null) => void;
  registerPage: (entry: Entry) => () => void;
} | null>(null);

export function usePageWorkspace() {
  return useContext(WorkspaceContext);
}

export function PageWorkspace({
  sessions,
  children,
}: {
  sessions: ReturnType<typeof useSessions>;
  children: ReactNode;
}) {
  const [docked, setDocked] = useFrontState<readonly string[]>("pages.dockedFiles", []);
  const [fileShowing, setFileShowing] = useFrontState<string | null>("pages.showingFile", null);
  const [split, setSplit] = useFrontState<string | null>("pages.lowerSidebar", null);
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const [hosts, setHosts] = useState<ReadonlyMap<string, HTMLElement>>(new Map());
  const { sessions: terminals, showing, paged, page, dock, jump, hide, restore } = sessions;
  const shownId = showing === null ? fileShowing : terminalPageId(showing);

  useEffect(() => {
    if (showing !== null) setFileShowing(null);
  }, [showing]);

  const registerHost = useCallback((key: string, host: HTMLElement | null) => {
    setHosts((held) => {
      const next = new Map(held);
      if (host) next.set(key, host);
      else next.delete(key);
      return next;
    });
  }, []);

  const registerPage = useCallback((entry: Entry) => {
    setEntries((held) => [...held.filter((one) => one.id !== entry.id), entry]);
    return () => setEntries((held) => held.filter((one) => one.id !== entry.id));
  }, []);

  const placement = useCallback((id: string) => placementOf(id, docked, paged), [docked, paged]);
  // A split whose lower page has since moved away, or that became the shown page, is no split.
  const lower =
    split !== null && shownId !== null && split !== shownId && placement(split) === "sidebar"
      ? split
      : null;

  // Ctrl+Alt+A: the lower pane takes the next page in the sidebar, else a new shell beside the
  // shown terminal. Again closes the split.
  const splitSidebar = useCallback(() => {
    if (lower !== null) return setSplit(null);
    if (shownId === null) return;
    const next = entries.find((entry) => entry.id !== shownId && placement(entry.id) === "sidebar");
    if (next) return setSplit(next.id);
    const shown = terminals.find((session) => terminalPageId(session.id) === shownId);
    if (!shown) return;
    // Restored, not opened: the shown terminal stays on top.
    const fresh = shellSession(shown.cwd, shown.branch, shown.folder);
    restore(fresh);
    setSplit(terminalPageId(fresh.id));
  }, [lower, shownId, entries, placement, terminals, restore]);
  const latestSplit = useRef(splitSidebar);
  latestSplit.current = splitSidebar;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.altKey || event.metaKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== "a") return;
      event.preventDefault();
      if (event.repeat) return;
      latestSplit.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const forget = useCallback((id: string) => {
    setDocked((held) => held.filter((one) => one !== id));
    setFileShowing((held) => (held === id ? null : held));
  }, []);

  const move = useCallback(
    (id: string, to: PagePlacement) => {
      const terminal = terminals.find((session) => terminalPageId(session.id) === id);
      setFileShowing(null);
      if (terminal) {
        if (to === "canvas") page(terminal);
        else dock(terminal);
        return;
      }
      if (to === "canvas") forget(id);
      else {
        setDocked((held) => (held.includes(id) ? held : [...held, id]));
        setFileShowing(id);
        hide();
      }
    },
    [terminals, page, dock, forget, hide],
  );

  const show = useCallback(
    (id: string) => {
      const terminal = terminals.find((session) => terminalPageId(session.id) === id);
      if (terminal) {
        setFileShowing(null);
        jump(terminal);
      } else {
        setFileShowing(id);
        hide();
      }
    },
    [terminals, jump, hide],
  );

  const hidePage = useCallback(() => {
    setFileShowing(null);
    hide();
  }, [hide]);
  const value = useMemo(
    () => ({
      entries,
      showing: shownId,
      lower,
      placement,
      move,
      show,
      hide: hidePage,
      forget,
    }),
    [entries, shownId, lower, placement, move, show, hidePage, forget],
  );
  const hosting = useMemo(
    () => ({ hosts, registerHost, registerPage }),
    [hosts, registerHost, registerPage],
  );

  return (
    <WorkspaceContext.Provider value={value}>
      <HostsContext.Provider value={hosting}>{children}</HostsContext.Provider>
    </WorkspaceContext.Provider>
  );
}

/** Hosts own layout; the page and its DOM survive a change of host. */
export function PageSlot({ id, place }: { id: string; place: PagePlacement | "pinned" | "cards" }) {
  const context = useContext(HostsContext);
  const register = context?.registerHost;
  const ref = useCallback(
    (host: HTMLDivElement | null) => register?.(`${place}/${id}`, host),
    [register, id, place],
  );
  return <div ref={ref} className="page-slot" />;
}

export function PagePortal({
  id,
  name,
  place,
  focus,
  children,
}: Entry & { place: PagePlacement | "pinned" | "cards"; focus?: string; children: ReactNode }) {
  const context = useContext(HostsContext);
  const register = context?.registerPage;
  const target = context?.hosts.get(`${place}/${id}`);
  const [container] = useState(() => {
    const element = document.createElement("div");
    element.className = "page-portal";
    return element;
  });
  useLayoutEffect(() => register?.({ id, name }), [register, id, name]);
  useLayoutEffect(() => {
    target?.appendChild(container);
    return () => container.remove();
  }, [container, target]);
  useLayoutEffect(() => {
    if (target?.isConnected && focus) container.querySelector<HTMLElement>(focus)?.focus();
  }, [container, target, focus]);
  return createPortal(children, container);
}

/** Window controls keep their state while following the visible sidebar header. */
export function usePageHeaderHost() {
  const workspace = usePageWorkspace();
  const context = useContext(HostsContext);
  return workspace?.showing ? context?.hosts.get(`header/${workspace.showing}`) : undefined;
}

export function PageHeaderSlot({ id }: { id: string }) {
  const register = useContext(HostsContext)?.registerHost;
  const ref = useCallback(
    (host: HTMLDivElement | null) => register?.(`header/${id}`, host),
    [register, id],
  );
  return <div ref={ref} className="page__window-controls" />;
}

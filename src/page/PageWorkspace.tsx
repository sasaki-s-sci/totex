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
  terminals: ReturnType<typeof useSessions>["sessions"];
  expanded: readonly string[];
  toggleExpanded: (id: string) => void;
  showing: string | null;
  /** The sidebar's lower pane, when it is split; never the page showing above it. */
  lower: string | null;
  active: string | null;
  activePlace: "cards" | "sidebar";
  activate: (id: string, place: string) => void;
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
  const [expanded, setExpanded] = useFrontState<readonly string[]>("pages.expandedTerminals", []);
  const toggleExpanded = useCallback((id: string) => {
    setExpanded((held) => (held.includes(id) ? held.filter((one) => one !== id) : [...held, id]));
  }, []);
  const [docked, setDocked] = useFrontState<readonly string[]>("pages.dockedFiles", []);
  const [fileShowing, setFileShowing] = useFrontState<string | null>("pages.showingFile", null);
  const { split, setSplit, active, activePlace, setActivePlace, select } = sessions;
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const [hosts, setHosts] = useState<ReadonlyMap<string, HTMLElement>>(new Map());
  const { sessions: terminals, showing, paged, page, dock, hide, restore } = sessions;
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
    split !== null &&
    shownId !== null &&
    split !== shownId &&
    entries.some((entry) => entry.id === split) &&
    placement(split) === "sidebar"
      ? split
      : null;

  // Ctrl+Alt+A: the lower pane takes the next page in the sidebar, else a new shell beside the
  // shown terminal. Again closes the split.
  const splitSidebar = useCallback(() => {
    setActivePlace("sidebar");
    if (lower !== null) {
      setSplit(null);
      select(showing);
      return;
    }
    if (shownId === null) return;
    const next = entries.find((entry) => entry.id !== shownId && placement(entry.id) === "sidebar");
    if (next) {
      setSplit(next.id);
      const terminal = terminals.find((session) => terminalPageId(session.id) === next.id);
      if (terminal) select(terminal.id);
      return;
    }
    const shown = terminals.find((session) => terminalPageId(session.id) === shownId);
    if (!shown) return;
    // Restored, not opened: the shown terminal stays on top.
    const fresh = shellSession(shown.cwd, shown.branch, shown.folder);
    restore(fresh, false);
    setSplit(terminalPageId(fresh.id));
    select(fresh.id);
  }, [
    lower,
    shownId,
    entries,
    placement,
    terminals,
    restore,
    showing,
    select,
    setSplit,
    setActivePlace,
  ]);
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
      setActivePlace("sidebar");
      const terminal = terminals.find((session) => terminalPageId(session.id) === id);
      if (terminal) {
        setFileShowing(null);
        dock(terminal);
      } else {
        setFileShowing(id);
        hide();
      }
    },
    [terminals, dock, hide, setActivePlace],
  );

  const activate = useCallback(
    (id: string, place: string) => {
      setActivePlace(place === "sidebar" ? "sidebar" : "cards");
      const terminal = terminals.find((session) => terminalPageId(session.id) === id);
      if (terminal) select(terminal.id);
    },
    [terminals, select, setActivePlace],
  );

  const hidePage = useCallback(() => {
    setFileShowing(null);
    hide();
  }, [hide]);
  const value = useMemo(
    () => ({
      entries,
      terminals,
      expanded,
      toggleExpanded,
      showing: shownId,
      lower,
      active: active === null ? null : terminalPageId(active),
      activePlace,
      activate,
      placement,
      move,
      show,
      hide: hidePage,
      forget,
    }),
    [
      entries,
      terminals,
      expanded,
      toggleExpanded,
      shownId,
      lower,
      active,
      activePlace,
      activate,
      placement,
      move,
      show,
      hidePage,
      forget,
    ],
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
  return <div ref={ref} className="page-slot" data-page-id={id} />;
}

export function PagePortal({
  id,
  name,
  place,
  focus,
  registerEntry = true,
  children,
}: Entry & {
  place: PagePlacement | "pinned" | "cards";
  focus?: string;
  registerEntry?: boolean;
  children: ReactNode;
}) {
  const context = useContext(HostsContext);
  const activate = usePageWorkspace()?.activate;
  const register = context?.registerPage;
  const target = context?.hosts.get(`${place}/${id}`);
  const [container] = useState(() => {
    const element = document.createElement("div");
    element.className = "page-portal";
    return element;
  });
  useLayoutEffect(
    () => (registerEntry ? register?.({ id, name }) : undefined),
    [register, registerEntry, id, name],
  );
  useEffect(() => {
    const select = () => activate?.(id, place);
    // Portal events follow the React tree, so observe focus on the actual page container.
    container.addEventListener("focusin", select);
    container.addEventListener("pointerdown", select);
    return () => {
      container.removeEventListener("focusin", select);
      container.removeEventListener("pointerdown", select);
    };
  }, [container, activate, id, place]);
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

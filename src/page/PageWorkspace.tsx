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
import { createPortal, flushSync } from "react-dom";
import { usePageKeys } from "../hooks/usePageKeys";
import type { useSessions } from "../hooks/useSessions";
import { settingsNow } from "../lib/appSettings";
import { shellSession } from "../lib/session";
import { useFrontState } from "../shell/state";
import { horizontalNeighbor } from "./neighbor";
import { type PagePlacement, placementOf, terminalPageId } from "./placement";

type Entry = { id: string; name: string; folder?: string };
type Workspace = {
  entries: readonly Entry[];
  numbered: readonly Entry[];
  terminals: ReturnType<typeof useSessions>["sessions"];
  reorder: (ids: readonly string[]) => void;
  registerClose: (id: string, close: () => Promise<boolean>) => () => void;
  expanded: readonly string[];
  toggleExpanded: (id: string) => void;
  showing: string | null;
  sidebarOpen: boolean;
  openSidebar: () => void;
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
  const [registered, setEntries] = useState<readonly Entry[]>([]);
  const [order, setOrder] = useFrontState<readonly string[]>("pages.order", []);
  const entries = useMemo(
    () => [
      ...order.flatMap((id) => registered.filter((entry) => entry.id === id)),
      ...registered.filter((entry) => !order.includes(entry.id)),
    ],
    [registered, order],
  );
  const numbered = useMemo(() => entries.filter((entry) => entry.id !== "file:-1"), [entries]);
  const reorderTerminals = sessions.reorder;
  const reorder = useCallback(
    (ids: readonly string[]) => {
      const next = ids.filter((id) => id !== "file:-1");
      setOrder((held) =>
        held.length === next.length && held.every((id, index) => id === next[index]) ? held : next,
      );
      reorderTerminals(next.filter((id) => id.startsWith("terminal:")).map((id) => id.slice(9)));
    },
    [reorderTerminals],
  );
  const [selection, setSelection] = useState({
    id: active === null ? null : terminalPageId(active),
    terminal: active,
  });
  const selected =
    active !== null && selection.terminal !== active ? terminalPageId(active) : selection.id;
  const activePage = useRef(selected);
  activePage.current = selected;
  const closers = useRef(new Map<string, () => Promise<boolean>>());
  const registerClose = useCallback((id: string, close: () => Promise<boolean>) => {
    closers.current.set(id, close);
    return () => {
      closers.current.delete(id);
    };
  }, []);
  const [hosts, setHosts] = useState<ReadonlyMap<string, HTMLElement>>(new Map());
  const { sessions: terminals, showing, paged, page, dock, hide, restore } = sessions;
  const shownId = showing === null ? fileShowing : terminalPageId(showing);
  const [sidebarOpen, setSidebarOpen] = useFrontState("pages.sidebarOpen", shownId !== null);

  useLayoutEffect(() => {
    if (shownId !== null) setSidebarOpen(true);
  }, [shownId]);

  useEffect(() => {
    if (showing !== null) setFileShowing(null);
  }, [showing]);

  useLayoutEffect(() => {
    if (active !== null)
      setSelection((held) =>
        held.terminal === active ? held : { id: terminalPageId(active), terminal: active },
      );
  }, [active]);

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

  const activate = useCallback(
    (id: string, place: string) => {
      const side = place === "sidebar" ? "sidebar" : "cards";
      activePage.current = id;
      const terminal = terminals.find((session) => terminalPageId(session.id) === id);
      setSelection({ id, terminal: terminal?.id ?? active });
      setActivePlace(side);
      if (terminal) select(terminal.id);
    },
    [terminals, select, setActivePlace, active],
  );

  // Ctrl+Alt+A: the lower pane takes the next page in the sidebar, else a new shell beside the
  // shown terminal. Again closes the split.
  const splitSidebar = useCallback(() => {
    setActivePlace("sidebar");
    if (lower !== null) {
      setSplit(null);
      if (shownId) activate(shownId, "sidebar");
      return;
    }
    if (shownId === null) return;
    const next = entries.find((entry) => entry.id !== shownId && placement(entry.id) === "sidebar");
    if (next) {
      setSplit(next.id);
      activate(next.id, "sidebar");
      return;
    }
    const shown = terminals.find((session) => terminalPageId(session.id) === shownId);
    if (!shown) return;
    // Restored, not opened: the shown terminal stays on top.
    const fresh = shellSession(shown.cwd, shown.branch, shown.folder);
    restore(fresh, false);
    setSplit(terminalPageId(fresh.id));
    activate(terminalPageId(fresh.id), "sidebar");
  }, [lower, shownId, entries, placement, terminals, restore, activate, setSplit, setActivePlace]);
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

  const forget = useCallback(
    (id: string) => {
      setDocked((held) => held.filter((one) => one !== id));
      setFileShowing((held) => (held === id ? null : held));
      setSplit((held) => (held === id ? null : held));
    },
    [setSplit],
  );

  const show = useCallback(
    (id: string, closing?: string) => {
      setSidebarOpen(true);
      if ((id !== shownId && id !== lower) || closing === shownId) {
        const below = lower !== null && activePage.current === lower && closing !== shownId;
        if (closing === shownId) setSplit(null);
        const terminal = terminals.find((session) => terminalPageId(session.id) === id);
        if (terminal) {
          if (!below) setFileShowing(null);
          dock(terminal, below);
        } else {
          setDocked((held) => (held.includes(id) ? held : [...held, id]));
          if (below) setSplit(id);
          else {
            hide();
            setSplit(closing === shownId ? null : lower);
            setFileShowing(id);
          }
        }
      }
      activate(id, "sidebar");
    },
    [terminals, dock, hide, lower, shownId, activate, setSplit],
  );

  const move = useCallback(
    (id: string, to: PagePlacement) => {
      if (to === "sidebar") {
        show(id);
        return;
      }
      const terminal = terminals.find((session) => terminalPageId(session.id) === id);
      if (terminal) page(terminal);
      else forget(id);
      activate(id, "cards");
    },
    [terminals, page, forget, show, activate],
  );

  const pending = useRef(new Set<string>());
  const currentEntries = useRef(entries);
  currentEntries.current = entries;
  const close = useCallback(
    async (id: string) => {
      if (pending.current.has(id)) return;
      const terminal = terminals.find((session) => terminalPageId(session.id) === id);
      const end = terminal ? () => sessions.end(terminal) : closers.current.get(id);
      if (!end) return;
      const at = numbered.findIndex((entry) => entry.id === id);
      const next = [...numbered.slice(at + 1), ...numbered.slice(0, at)];
      pending.current.add(id);
      try {
        if (!(await end()) || activePage.current !== id) return;
        const following = next.find((entry) =>
          currentEntries.current.some((one) => one.id === entry.id),
        );
        if (following) show(following.id, id);
      } finally {
        pending.current.delete(id);
      }
    },
    [numbered, terminals, sessions.end, show],
  );
  usePageKeys({
    entries: numbered,
    active: selected,
    show,
    close,
    create: () => {
      const terminal = terminals.find((session) => terminalPageId(session.id) === selected);
      if (terminal)
        sessions.open(
          shellSession(terminal.cwd, terminal.branch, terminal.folder),
          settingsNow().terminalSort === "createdWhere" ? terminal.id : undefined,
        );
    },
  });

  const openSidebar = useCallback(() => {
    setSidebarOpen(true);
    if (shownId !== null) return;
    const next = entries.find((entry) => placement(entry.id) === "sidebar");
    if (next) show(next.id);
    else if (terminals[0]) show(terminalPageId(terminals[0].id));
  }, [shownId, entries, placement, show, terminals]);

  const horizontal = useRef<{ key: string; offset: number } | null>(null);
  useEffect(() => {
    const reset = () => {
      horizontal.current = null;
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        !event.ctrlKey ||
        event.altKey ||
        event.metaKey ||
        event.shiftKey ||
        (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
      ) {
        if (event.key !== "Control") reset();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat) return;
      const visible = [...hosts].flatMap(([key, host]) => {
        if (!key.startsWith("cards/") && !key.startsWith("sidebar/")) return [];
        const box = host.getBoundingClientRect();
        if (
          !host.isConnected ||
          box.width === 0 ||
          box.height === 0 ||
          getComputedStyle(host).visibility !== "visible"
        )
          return [];
        return [{ key, host, left: box.left, right: box.right, top: box.top, bottom: box.bottom }];
      });
      const source =
        visible.find(({ host }) => event.target instanceof Node && host.contains(event.target)) ??
        visible.find(({ key }) => key === `${activePlace}/${selected}`);
      if (!source) return;
      // Keep the entry row when crossing a taller card, including after scrolling it into view.
      const y =
        source.top +
        (horizontal.current?.key === source.key
          ? horizontal.current.offset
          : (source.bottom - source.top) / 2);
      const next = horizontalNeighbor(
        { ...source, top: y, bottom: y },
        visible.filter((candidate) => candidate !== source),
        event.key === "ArrowLeft" ? "left" : "right",
      );
      if (!next) return;
      const { host, key } = next;
      horizontal.current = {
        key,
        offset: Math.max(0, Math.min(y - next.top, next.bottom - next.top)),
      };
      const slash = key.indexOf("/");
      const side = key.slice(0, slash);
      const id = key.slice(slash + 1);
      flushSync(() => activate(id, side));
      host.scrollIntoView({ block: "nearest", inline: "nearest" });
      const target =
        host.querySelector<HTMLElement>(
          '.page-agent button, .xterm-helper-textarea, [contenteditable]:not([contenteditable="false"])',
        ) ?? host.querySelector<HTMLElement>(".page");
      target?.focus({ preventScroll: true });
    };
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("pointerdown", reset, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("pointerdown", reset, true);
    };
  }, [hosts, activePlace, selected, activate]);

  const hidePage = useCallback(() => {
    setSidebarOpen(false);
    setFileShowing(null);
    hide();
  }, [hide]);
  const value = useMemo(
    () => ({
      entries,
      numbered,
      terminals,
      reorder,
      registerClose,
      expanded,
      toggleExpanded,
      showing: shownId,
      sidebarOpen,
      openSidebar,
      lower,
      active: selected,
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
      numbered,
      terminals,
      reorder,
      registerClose,
      expanded,
      toggleExpanded,
      shownId,
      sidebarOpen,
      openSidebar,
      lower,
      selected,
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
  folder,
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
    () => (registerEntry ? register?.({ id, name, folder }) : undefined),
    [register, registerEntry, id, name, folder],
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
    if (target?.isConnected && focus)
      container.querySelector<HTMLElement>(focus)?.focus({ preventScroll: true });
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

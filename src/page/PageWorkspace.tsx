import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useState,
} from "react";
import { createPortal } from "react-dom";
import type { useSessions } from "../hooks/useSessions";
import { useFrontState } from "../shell/state";
import { type PagePlacement, placementOf, terminalPageId } from "./placement";

type Entry = { id: string; name: string };
type Workspace = {
  entries: readonly Entry[];
  showing: string | null;
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
  const [entries, setEntries] = useState<readonly Entry[]>([]);
  const [hosts, setHosts] = useState<ReadonlyMap<string, HTMLElement>>(new Map());
  const { sessions: terminals, showing, paged, page, dock, jump, hide } = sessions;

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
      showing: showing === null ? fileShowing : terminalPageId(showing),
      placement,
      move,
      show,
      hide: hidePage,
      forget,
    }),
    [entries, showing, fileShowing, placement, move, show, hidePage, forget],
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
export function PageSlot({ id, place }: { id: string; place: PagePlacement | "pinned" }) {
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
}: Entry & { place: PagePlacement | "pinned"; focus?: string; children: ReactNode }) {
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

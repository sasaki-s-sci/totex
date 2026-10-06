import { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { describeFolders, listRoots, type Place, type Root, resolveFolder } from "../../folder/api";
import { type Graphed, type GraphedKind, graphedKey, type PaneSeed } from "../../lib/graphed";
import {
  forgetSshHost,
  parseSshTyped,
  reachSsh,
  reachSshWith,
  readSshHost,
  rememberSshHost,
  type SshFailureKey,
  sshFailure,
  sshHome,
  sshHostOf,
  sshHosts,
} from "../../lib/ssh";
import { type Homes, homeAfterRemoval } from "../../lib/worktrees";
import { useFrontState } from "../../shell/state";
import { keepPlaces, keptPlaces } from "./places";

/**
 * One explorer. A folder pane browses one directory at a time; a repository pane lists the
 * repositories under a root. Only `graphed` places are scanned.
 */
export interface Pane {
  id: number;
  kind: GraphedKind;
  /** A folder pane browses this and moves; a repository pane lists under this and never moves. */
  path: string;
  open: boolean;
  /** Hidden in the sidebar tray while its graphed places keep running. */
  minimized?: boolean;
  /** Folder pane: folders on the canvas as folders. Repository pane: repositories on the canvas. */
  graphed: string[];
  /** Repository pane: rows opened out to their files, by repository path. */
  expanded: string[];
  /** Repository pane: the worktree a row shows in place of the repository's own folder, by repository path. */
  shown: Record<string, string>;
}

/** An ssh failure, under the field it came from. */
export interface SshFailed {
  at: "path" | "ssh";
  key: SshFailureKey;
  reason: string;
}

/** The canvas asking the pane that graphed `root` to browse `path`. */
export interface FolderDestination {
  root: string;
  path: string;
}

/** The canvas asking every pane that graphed `root` by this kind to stop. A new object each time. */
export interface FolderUngraph {
  root: string;
  kind?: GraphedKind;
}

const NO_HOMES: Homes = new Map();

/** Reports `value` only when it changes by value: a report becomes scans. */
export function useReport<T>(value: T, report?: (value: T) => void) {
  const latest = useRef(report);
  useEffect(() => {
    latest.current = report;
  }, [report]);

  const key = JSON.stringify(value);
  useEffect(() => {
    latest.current?.(JSON.parse(key));
  }, [key]);
}

function whole(pane: Pane): boolean {
  return (
    (pane.kind === "folder" || pane.kind === "repository") &&
    Array.isArray(pane.expanded) &&
    pane.shown !== null &&
    typeof pane.shown === "object" &&
    typeof pane.minimized === "boolean"
  );
}

/** A pane written by an earlier front had a path and a graph alone, which made it a folder pane. */
function readPane(pane: Pane): Pane {
  if (whole(pane)) return pane;
  return {
    ...pane,
    minimized: pane.minimized === true,
    kind: pane.kind === "repository" ? "repository" : "folder",
    expanded: Array.isArray(pane.expanded) ? pane.expanded : [],
    shown: pane.shown !== null && typeof pane.shown === "object" ? pane.shown : {},
  };
}

function fresh(id: number, kind: GraphedKind, path: string, open: boolean): Pane {
  return { id, kind, path, open, minimized: false, graphed: [], expanded: [], shown: {} };
}

/** The path a repository's row reads: the worktree put in its place, or its own folder. */
export function shownPath(pane: Pane, repository: string): string {
  return pane.shown[repository] ?? repository;
}

export function usePanes(
  initial: readonly PaneSeed[],
  onGraphedChange: ((graphed: Graphed[]) => void) | undefined,
  onPanesChange: ((panes: PaneSeed[]) => void) | undefined,
  onBrowsingChange: ((paths: string[]) => void) | undefined,
  destination?: FolderDestination | null,
  homes?: Homes,
  ungraph?: FolderUngraph | null,
  onMinimizedPanesChange?: (places: Graphed[]) => void,
) {
  const nextId = useRef(0);
  const [held, setPanes] = useFrontState<Pane[]>("folders.panes", () =>
    initial.map((seed) => ({
      ...fresh(nextId.current++, seed.kind, seed.path, false),
      minimized: seed.minimized === true,
    })),
  );
  // Read as a claim: the front may hand back panes an earlier version wrote. Settled once, before
  // any press can reach an updater.
  const panes = useMemo(() => (held.every(whole) ? held : held.map(readPane)), [held]);
  useEffect(() => {
    if (panes !== held) setPanes(panes);
  }, [panes, held]);
  nextId.current = Math.max(nextId.current, ...panes.map((pane) => pane.id + 1));
  const column = useRef<HTMLDivElement>(null);

  const [roots, setRoots] = useState<Root[] | null>(null);
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [asking, setAsking] = useState<GraphedKind>("folder");
  const [typed, setTyped] = useState("");
  const [refused, setRefused] = useState(false);
  const [hosts, setHosts] = useState(sshHosts);
  const [sshTyped, setSshTyped] = useState("");
  const [sshFailed, setSshFailed] = useState<SshFailed | null>(null);
  /** The host a pick is waiting on. */
  const [reaching, setReaching] = useState<string | null>(null);
  /** Hosts given a password since the panes came up: their panes read again. */
  const [unlocked, setUnlocked] = useState<ReadonlySet<string>>(() => new Set());

  // The password is asked up front for panes left on a host by the last run.
  // biome-ignore lint/correctness/useExhaustiveDependencies: once, for the panes the run began with
  useEffect(() => {
    const remote = new Set(panes.flatMap((pane) => sshHostOf(pane.path) ?? []));
    for (const host of remote) {
      reachSshWith(host)
        .then((reach) => {
          if (reach === "given") setUnlocked((held) => new Set(held).add(host));
        })
        .catch(() => undefined);
    }
  }, []);

  // One place once, however many panes graphed it: the canvas draws a place, not a pane.
  const graphed = useMemo(() => {
    const seen = new Set<string>();
    const all: Graphed[] = [];
    for (const pane of panes) {
      for (const root of pane.graphed) {
        const one: Graphed = { kind: pane.kind, root };
        const key = graphedKey(one);
        if (seen.has(key)) continue;
        seen.add(key);
        all.push(one);
      }
    }
    return all;
  }, [panes]);
  useReport(graphed, onGraphedChange);
  const minimizedPlaces = useMemo(() => {
    const visible = new Set(
      panes
        .filter((pane) => !pane.minimized)
        .flatMap((pane) => pane.graphed.map((root) => graphedKey({ kind: pane.kind, root }))),
    );
    return graphed.filter((place) => !visible.has(graphedKey(place)));
  }, [panes, graphed]);
  useReport(minimizedPlaces, onMinimizedPanesChange);
  const seeds = useMemo(
    () =>
      panes.map(
        (pane): PaneSeed => ({
          kind: pane.kind,
          path: pane.path,
          ...(pane.minimized ? { minimized: true } : {}),
        }),
      ),
    [panes],
  );
  useReport(seeds, onPanesChange);
  // What is being read: a folder pane's folder, and the files each opened row shows.
  const browsing = useMemo(
    () =>
      panes
        .filter((pane) => !pane.minimized)
        .flatMap((pane) =>
          pane.kind === "folder"
            ? [pane.path]
            : pane.expanded.map((repository) => shownPath(pane, repository)),
        ),
    [panes],
  );
  useReport(browsing, onBrowsingChange);

  // biome-ignore lint/correctness/useExhaustiveDependencies: destination is the request; panes is the current answer to it
  useEffect(() => {
    if (!destination) return;
    const { root, path } = destination;
    // A repository on the canvas from a list is browsed in its row: the row opens out and shows
    // the worktree asked for, and the row stays the repository's own.
    const listing = panes.find(
      (candidate) => candidate.kind === "repository" && candidate.graphed.includes(root),
    );
    if (listing) {
      update(listing.id, {
        minimized: false,
        open: true,
        expanded: listing.expanded.includes(root) ? listing.expanded : [...listing.expanded, root],
        shown: withShown(listing.shown, root, path),
      });
      requestAnimationFrame(() => {
        column.current
          ?.querySelector<HTMLElement>(`[data-repo-row="${listing.id}:${CSS.escape(root)}"]`)
          ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
      });
      return;
    }
    const pane =
      panes.find((candidate) => candidate.kind === "folder" && candidate.path === path) ??
      panes.find((candidate) => candidate.kind === "folder" && candidate.graphed.includes(root));
    if (!pane) {
      addPane(path, "folder");
      return;
    }
    update(pane.id, { path, open: true, minimized: false });
    requestAnimationFrame(() => {
      column.current
        ?.querySelector<HTMLElement>(`[data-folder-pane="${pane.id}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, [destination]);

  useEffect(() => {
    if (!ungraph) return;
    const { root, kind = "folder" } = ungraph;
    setPanes((current) =>
      current.some((pane) => pane.kind === kind && pane.graphed.includes(root))
        ? current.map((pane) =>
            pane.kind === kind && pane.graphed.includes(root)
              ? { ...pane, graphed: pane.graphed.filter((held) => held !== root) }
              : pane,
          )
        : current,
    );
  }, [ungraph]);

  // A pane whose worktree was deleted goes to the repository's main copy; a row showing a deleted
  // worktree goes back to the repository's own folder.
  const standing = homes ?? NO_HOMES;
  const known = useRef(standing);
  useEffect(() => {
    const before = known.current;
    known.current = standing;
    if (before === standing) return;
    setPanes((current) => {
      let moved = false;
      const next = current.map((pane) => {
        if (pane.kind === "repository") {
          const kept: Record<string, string> = {};
          let dropped = false;
          for (const [repository, path] of Object.entries(pane.shown)) {
            const home = homeAfterRemoval(before, standing, path);
            if (home === null || home === path) kept[repository] = path;
            else dropped = true;
          }
          if (!dropped) return pane;
          moved = true;
          return { ...pane, shown: kept };
        }
        const home = homeAfterRemoval(before, standing, pane.path);
        if (home === null || home === pane.path) return pane;
        moved = true;
        return { ...pane, path: home };
      });
      return moved ? next : current;
    });
  }, [standing]);

  function update(id: number, change: Partial<Pane>) {
    setPanes((current) => current.map((pane) => (pane.id === id ? { ...pane, ...change } : pane)));
  }

  /**
   * A folder pane standing in a checkout turns into the repository pane for it, the row opened out
   * to its files. The folder on the canvas goes on as the repository; anything else the pane put
   * there leaves with the folder pane, as it would were the pane closed.
   */
  function toRepository(id: number) {
    setPanes((current) =>
      current.map((pane) =>
        pane.id === id && pane.kind === "folder"
          ? {
              ...pane,
              kind: "repository",
              open: true,
              graphed: pane.graphed.includes(pane.path) ? [pane.path] : [],
              expanded: [pane.path],
              shown: {},
            }
          : pane,
      ),
    );
  }

  /**
   * The way back: a repository pane listing only its own checkout turns into the folder pane on
   * it. The repository on the canvas goes on as the folder, as `toRepository` took it.
   */
  function toFolder(id: number) {
    setPanes((current) =>
      current.map((pane) =>
        pane.id === id && pane.kind === "repository"
          ? {
              ...pane,
              kind: "folder",
              open: true,
              graphed: pane.graphed.includes(pane.path) ? [pane.path] : [],
              expanded: [],
              shown: {},
            }
          : pane,
      ),
    );
  }

  function toggleGraph(id: number, path: string) {
    setPanes((current) =>
      current.map((pane) =>
        pane.id === id
          ? {
              ...pane,
              graphed: pane.graphed.includes(path)
                ? pane.graphed.filter((held) => held !== path)
                : [...pane.graphed, path],
            }
          : pane,
      ),
    );
  }

  /**
   * The rows a repository pane has now: what it graphed, opened out or swapped for a worktree is
   * kept only for repositories still listed, so one gone from the root leaves the canvas with it
   * rather than staying with no row left to take it off.
   */
  function settleList(id: number, repositories: readonly string[]) {
    setPanes((current) =>
      current.map((pane) => {
        if (pane.id !== id || pane.kind !== "repository") return pane;
        const listed = new Set(repositories);
        const graphed = pane.graphed.filter((root) => listed.has(root));
        const expanded = pane.expanded.filter((root) => listed.has(root));
        const shown = Object.fromEntries(
          Object.entries(pane.shown).filter(([root]) => listed.has(root)),
        );
        const same =
          graphed.length === pane.graphed.length &&
          expanded.length === pane.expanded.length &&
          Object.keys(shown).length === Object.keys(pane.shown).length;
        return same ? pane : { ...pane, graphed, expanded, shown };
      }),
    );
  }

  function toggleExpanded(id: number, repository: string) {
    setPanes((current) =>
      current.map((pane) =>
        pane.id === id
          ? {
              ...pane,
              expanded: pane.expanded.includes(repository)
                ? pane.expanded.filter((held) => held !== repository)
                : [...pane.expanded, repository],
            }
          : pane,
      ),
    );
  }

  /** Opened out and kept so: a name typed under a row needs the row's level to be drawn in. */
  function expandRow(id: number, repository: string) {
    setPanes((current) =>
      current.map((pane) =>
        pane.id === id && !pane.expanded.includes(repository)
          ? { ...pane, open: true, expanded: [...pane.expanded, repository] }
          : pane.id === id
            ? { ...pane, open: true }
            : pane,
      ),
    );
  }

  /** `null`, or the repository's own path, puts the row back on its own folder. */
  function showWorktree(id: number, repository: string, path: string | null) {
    setPanes((current) =>
      current.map((pane) =>
        pane.id === id ? { ...pane, shown: withShown(pane.shown, repository, path) } : pane,
      ),
    );
  }

  /**
   * `kind` is what the menu's picks will add, however they are picked; left out, the menu opens
   * on the kind picked last, and its toggle changes it.
   */
  function openRootMenu(event: MouseEvent<HTMLElement>, kind?: GraphedKind) {
    setAnchor(event.currentTarget);
    if (kind) setAsking(kind);
    // Read each time: another window may have registered one, and `prime` lands after mount.
    setHosts(sshHosts());
    if (!roots) {
      listRoots()
        .then(setRoots)
        .catch(() => undefined);
    }
    if (!places) {
      describeFolders(keptPlaces())
        .then(setPlaces)
        .catch(() => setPlaces([]));
    }
  }

  function closeRootMenu() {
    setAnchor(null);
    setTyped("");
    setRefused(false);
    setSshTyped("");
    setSshFailed(null);
  }

  /** `then` once `host` lets us in; a cancelled password does nothing. */
  function reachThen(host: string, at: SshFailed["at"], then: () => void) {
    setReaching(host);
    setSshFailed(null);
    reachSsh(host)
      .then((reached) => {
        if (reached) then();
      })
      .catch((error) => setSshFailed({ at, ...sshFailure(error) }))
      .finally(() => setReaching(null));
  }

  /** A pick from the menu: a path on a host is reached first, so a password is asked here. */
  function pick(path: string) {
    const host = sshHostOf(path);
    if (host) reachThen(host, "ssh", () => addPane(path));
    else addPane(path);
  }

  function addSshTyped() {
    const host = readSshHost(sshTyped);
    if (!host) {
      setSshFailed({ at: "ssh", key: "ssh.notHost", reason: "" });
      return;
    }
    setHosts(rememberSshHost(host));
    const url = parseSshTyped(sshTyped)?.url ?? sshHome(host);
    setSshTyped("");
    reachThen(host, "ssh", () => addPane(url));
  }

  function forgetSsh(host: string) {
    setHosts(forgetSshHost(host));
  }

  function keepTyped() {
    const asked = typed.trim();
    if (!asked) return;
    // `ssh a@ip ~/repo` registers the host and goes where it would have landed.
    const command = parseSshTyped(asked);
    if (command) setHosts(rememberSshHost(command.host));
    const path = command?.url ?? asked;
    const host = command?.host ?? sshHostOf(path);
    // A host's home is already its SSH row.
    const keep = command?.path !== "~";
    if (host) reachThen(host, "path", () => resolveTyped(path, keep));
    else resolveTyped(path, keep);
  }

  function resolveTyped(asked: string, keep: boolean) {
    resolveFolder(asked)
      .then((place) => {
        if (keep) {
          const held = places ?? [];
          const kept = held.some((one) => one.path === place.path) ? held : [...held, place];
          setPlaces(kept);
          keepPlaces(kept);
        }
        setTyped("");
        setRefused(false);
        addPane(place.path);
      })
      .catch(() => setRefused(true));
  }

  function dropPlace(path: string) {
    const kept = (places ?? []).filter((one) => one.path !== path);
    setPlaces(kept);
    keepPlaces(kept);
  }

  /** Without `kind`, the kind the menu was opened for. */
  function addPane(path: string, kind: GraphedKind = asking) {
    closeRootMenu();
    setPanes((current) => [...current, fresh(nextId.current++, kind, path, true)]);
    requestAnimationFrame(() => {
      const box = column.current;
      if (box) box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
    });
  }

  /** Changes once a pane's host is given a password, so the pane is drawn, and read, afresh. */
  function paneKey(pane: Pane): string {
    const host = sshHostOf(pane.path);
    return host && unlocked.has(host) ? `${pane.id}:unlocked` : String(pane.id);
  }

  return {
    panes,
    paneKey,
    setPanes,
    column,
    roots,
    places,
    anchor,
    asking,
    setAsking,
    typed,
    setTyped,
    refused,
    setRefused,
    update,
    toRepository,
    toFolder,
    toggleGraph,
    settleList,
    toggleExpanded,
    expandRow,
    showWorktree,
    openRootMenu,
    closeRootMenu,
    addPane,
    dropPlace,
    keepTyped,
    hosts,
    sshTyped,
    setSshTyped,
    sshFailed,
    setSshFailed,
    reaching,
    pick,
    addSshTyped,
    forgetSsh,
  };
}

function withShown(
  shown: Record<string, string>,
  repository: string,
  path: string | null,
): Record<string, string> {
  const { [repository]: _, ...rest } = shown;
  return path === null || path === repository ? rest : { ...rest, [repository]: path };
}

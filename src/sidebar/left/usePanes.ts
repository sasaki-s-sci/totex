import { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { describeFolders, listRoots, type Place, type Root, resolveFolder } from "../../folder/api";
import { type Graphed, type GraphedKind, graphedKey, type PaneSeed } from "../../lib/graphed";
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
  /** Folder pane: folders on the canvas as folders. Repository pane: repositories on the canvas. */
  graphed: string[];
  /** Repository pane: rows opened out to their files, by repository path. */
  expanded: string[];
  /** Repository pane: the worktree a row shows in place of the repository's own folder, by repository path. */
  shown: Record<string, string>;
}

/** The canvas asking the pane that graphed `root` to browse `path`. */
export interface FolderDestination {
  root: string;
  path: string;
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
    typeof pane.shown === "object"
  );
}

/** A pane written by an earlier front had a path and a graph alone, which made it a folder pane. */
function readPane(pane: Pane): Pane {
  if (whole(pane)) return pane;
  return {
    ...pane,
    kind: pane.kind === "repository" ? "repository" : "folder",
    expanded: Array.isArray(pane.expanded) ? pane.expanded : [],
    shown: pane.shown !== null && typeof pane.shown === "object" ? pane.shown : {},
  };
}

function fresh(id: number, kind: GraphedKind, path: string, open: boolean): Pane {
  return { id, kind, path, open, graphed: [], expanded: [], shown: {} };
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
) {
  const nextId = useRef(0);
  const [held, setPanes] = useFrontState<Pane[]>("folders.panes", () =>
    initial.map((seed) => fresh(nextId.current++, seed.kind, seed.path, false)),
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
  const seeds = useMemo(
    () => panes.map((pane): PaneSeed => ({ kind: pane.kind, path: pane.path })),
    [panes],
  );
  useReport(seeds, onPanesChange);
  // What is being read: a folder pane's folder, and the files each opened row shows.
  const browsing = useMemo(
    () =>
      panes.flatMap((pane) =>
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
    update(pane.id, { path, open: true });
    requestAnimationFrame(() => {
      column.current
        ?.querySelector<HTMLElement>(`[data-folder-pane="${pane.id}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, [destination]);

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
  }

  function keepTyped() {
    const asked = typed.trim();
    if (!asked) return;
    resolveFolder(asked)
      .then((place) => {
        const held = places ?? [];
        const kept = held.some((one) => one.path === place.path) ? held : [...held, place];
        setPlaces(kept);
        keepPlaces(kept);
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

  return {
    panes,
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
    toggleGraph,
    toggleExpanded,
    expandRow,
    showWorktree,
    openRootMenu,
    closeRootMenu,
    addPane,
    dropPlace,
    keepTyped,
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

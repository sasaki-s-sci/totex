import { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { describeFolders, listRoots, type Place, type Root, resolveFolder } from "../../folder/api";
import { type Homes, homeAfterRemoval } from "../../lib/worktrees";
import { useFrontState } from "../../shell/state";
import { keepPlaces, keptPlaces } from "./places";

/** One explorer. Browsing reads one directory; only `graphed` folders are scanned. */
export interface Pane {
  id: number;
  path: string;
  open: boolean;
  graphed: string[];
}

/** The canvas asking the pane that graphed `root` to browse `path`. */
export interface FolderDestination {
  root: string;
  path: string;
}

const NO_HOMES: Homes = new Map();

/** Reports `paths` only when the set changes by value: a report becomes scans. */
export function useReport(paths: string[], report?: (paths: string[]) => void) {
  const latest = useRef(report);
  useEffect(() => {
    latest.current = report;
  }, [report]);

  const key = JSON.stringify(paths);
  useEffect(() => {
    latest.current?.(JSON.parse(key));
  }, [key]);
}

export function usePanes(
  initial: readonly string[],
  onFoldersChange: ((paths: string[]) => void) | undefined,
  onExpandedChange: ((paths: string[]) => void) | undefined,
  destination?: FolderDestination | null,
  homes?: Homes,
) {
  const nextId = useRef(0);
  const [panes, setPanes] = useFrontState<Pane[]>("folders.panes", () =>
    initial.map((path) => ({ id: nextId.current++, path, open: false, graphed: [] })),
  );
  nextId.current = Math.max(nextId.current, ...panes.map((pane) => pane.id + 1));
  const column = useRef<HTMLDivElement>(null);

  const [roots, setRoots] = useState<Root[] | null>(null);
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [typed, setTyped] = useState("");
  const [refused, setRefused] = useState(false);

  const expanded = useMemo(() => [...new Set(panes.flatMap((pane) => pane.graphed))], [panes]);
  useReport(expanded, onExpandedChange);
  const folders = useMemo(() => panes.map((pane) => pane.path), [panes]);
  useReport(folders, onFoldersChange);

  // biome-ignore lint/correctness/useExhaustiveDependencies: destination is the request; panes is the current answer to it
  useEffect(() => {
    if (!destination) return;
    const pane =
      panes.find((candidate) => candidate.path === destination.path) ??
      panes.find((candidate) => candidate.graphed.includes(destination.root));
    if (!pane) {
      addPane(destination.path);
      return;
    }
    update(pane.id, { path: destination.path, open: true });
    requestAnimationFrame(() => {
      column.current
        ?.querySelector<HTMLElement>(`[data-folder-pane="${pane.id}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    });
  }, [destination]);

  // A pane whose worktree was deleted goes to the repository's main copy.
  const standing = homes ?? NO_HOMES;
  const known = useRef(standing);
  useEffect(() => {
    const before = known.current;
    known.current = standing;
    if (before === standing) return;
    setPanes((current) => {
      let moved = false;
      const next = current.map((pane) => {
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

  function openRootMenu(event: MouseEvent<HTMLElement>) {
    setAnchor(event.currentTarget);
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

  function addPane(path: string) {
    closeRootMenu();
    setPanes((current) => [...current, { id: nextId.current++, path, open: true, graphed: [] }]);
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
    typed,
    setTyped,
    refused,
    setRefused,
    update,
    toggleGraph,
    openRootMenu,
    closeRootMenu,
    addPane,
    dropPlace,
    keepTyped,
  };
}

/**
 * The panes the explorer is holding, the menu of places one can be started at,
 * and everything either can be asked to do.
 */

import { type MouseEvent, useMemo, useRef, useState } from "react";
import { useResizeGrip } from "../components/useResizeGrip";
import { describeFolders, listRoots, type Place, type Root, resolveFolder } from "./api";
import { type Pane, useReport } from "./FolderSidebar";
import { keepPlaces, keptPlaces } from "./places";

const MIN_WIDTH = 200;
const MAX_WIDTH = 560;
const DEFAULT_WIDTH = 288;

export function usePanes(
  initial: readonly string[],
  onFoldersChange: ((paths: string[]) => void) | undefined,
  onExpandedChange: ((paths: string[]) => void) | undefined,
) {
  const nextId = useRef(0);
  const [panes, setPanes] = useState<Pane[]>(() =>
    initial.map((path) => ({ id: nextId.current++, path, open: true, graphed: [] })),
  );
  /** The scrolling part of the column, for showing a folder that was just added. */
  const column = useRef<HTMLDivElement>(null);
  /** The column itself, which the drag sizes directly. */
  const sidebar = useRef<HTMLDivElement>(null);
  // The grip is on the column's right edge, so dragging right widens it.
  const { width, grip } = useResizeGrip({
    min: MIN_WIDTH,
    max: MAX_WIDTH,
    initial: DEFAULT_WIDTH,
    side: "end",
    element: sidebar,
  });

  // The places a new pane can be started at, read once the plus is first used.
  const [roots, setRoots] = useState<Root[] | null>(null);
  // The folders that were kept, which is the other half of that menu. Read at
  // the same moment and held the same way: null until the plus has been used.
  const [places, setPlaces] = useState<Place[] | null>(null);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  /** What is in the path field. A folder that is not on the menu is reached by
   *  writing it out, which is also how one gets onto the menu. */
  const [typed, setTyped] = useState("");
  /** Set when the last thing typed named no folder, and cleared by the next
   *  keystroke: the field says so where it was typed, and nothing else does. */
  const [refused, setRefused] = useState(false);

  // What the graph is asked to draw. Two panes may have asked for the same
  // folder; the graph is handed it once.
  const expanded = useMemo(() => [...new Set(panes.flatMap((pane) => pane.graphed))], [panes]);
  useReport(expanded, onExpandedChange);

  // Where the panes are, which is what the column is restored from -- kept
  // apart from the above, because a folder being browsed is not a folder being
  // scanned.
  const folders = useMemo(() => panes.map((pane) => pane.path), [panes]);
  useReport(folders, onFoldersChange);

  function update(id: number, change: Partial<Pane>) {
    setPanes((current) => current.map((pane) => (pane.id === id ? { ...pane, ...change } : pane)));
  }

  /**
   * Puts one folder on the graph, or takes it off again.
   *
   * Held by the pane it was asked from, so closing that pane takes its folders
   * off the graph with it: nothing stays drawn with no button left to undo it.
   */
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
      // A machine that will not say where its drives are leaves the menu with
      // the places it already knows, which is usually all of them.
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

  /**
   * Takes what was written in the field: opens a pane there, and keeps it.
   *
   * The two at once, because they are one thing to do — a folder is written out
   * in order to go to it, and a folder worth writing out is a folder worth not
   * having to write out again. Keeping it is what puts it under the roots for
   * every window after this one; the mark on that row is what takes it back off.
   *
   * The backend settles the path first — `~` expanded, `..` folded, and the
   * disk asked whether it is a folder at all — so what is kept is a folder that
   * was there, and a typing mistake stays in the field it was made in.
   */
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
        // Which closes the menu, and scrolls the column to what was asked for.
        addPane(place.path);
      })
      .catch(() => setRefused(true));
  }

  /** Takes one folder back off the menu. The panes opened from it stay open:
   *  this is the list of places to start at, not a list of what is open. */
  function dropPlace(path: string) {
    const kept = (places ?? []).filter((one) => one.path !== path);
    setPlaces(kept);
    keepPlaces(kept);
  }

  /** Showing its rows from the start, and on the graph not at all: a folder is
   *  added in order to look through it, and looking through a folder full of
   *  repositories is not a request to read every one of them. */
  function addPane(path: string) {
    closeRootMenu();
    setPanes((current) => [...current, { id: nextId.current++, path, open: true, graphed: [] }]);
    // A folder is added below the ones already open, which for a column that is
    // already full is somewhere off the bottom of it — and a folder that was
    // asked for and then apparently did nothing is a folder that did not open.
    // Scrolled to on the next frame, once the pane it belongs to is drawn.
    requestAnimationFrame(() => {
      const box = column.current;
      if (box) box.scrollTo({ top: box.scrollHeight, behavior: "smooth" });
    });
  }

  return {
    panes,
    setPanes,
    nextId,
    column,
    sidebar,
    width,
    grip,
    roots,
    places,
    anchor,
    typed,
    setTyped,
    refused,
    setRefused,
    expanded,
    update,
    toggleGraph,
    openRootMenu,
    closeRootMenu,
    addPane,
    dropPlace,
    keepTyped,
  };
}

import { Box, Divider, ListItemIcon, ListItemText, Menu, MenuItem, Stack } from "@mui/material";
import { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AddMark, MarkButton, SettingsMark } from "../components/marks";
import { ResizeGrip, useResizeGrip } from "../components/useResizeGrip";
import { HEADER_HEIGHT, HEADER_INSET } from "../components/WindowControls";
import { listRoots, type Root } from "./api";
import { FolderPane } from "./FolderPane";
import { groupRoots, ROOT_ICONS } from "./roots";

const MIN_WIDTH = 200;
const MAX_WIDTH = 560;
const DEFAULT_WIDTH = 288;

/** One explorer, and the identity that keeps two of them at the same place
 *  from being the same pane. */
interface Pane {
  id: number;
  /** Where the pane is browsing now. Moving it is browsing and nothing else:
   *  one directory read, no walk of the tree under it. */
  path: string;
  /** Whether the rows under the name are shown. Display only. */
  open: boolean;
  /** The folders this pane has put on the graph. Every one of them was asked
   *  for by its own button; browsing never adds to this. */
  graphed: string[];
}

export interface FolderSidebarProps {
  /** Panes to stand up on the first render, e.g. paths restored from storage.
   *  They start browsing, and off the graph: what goes on the graph is asked
   *  for, so restoring a column does not scan anything. */
  initialFolders?: string[];
  /** Fires with every folder the graph should draw, whenever that set moves. */
  onExpandedChange?: (paths: string[]) => void;
  /** Fires with the folders the panes are showing, for restoring the column. */
  onFoldersChange?: (paths: string[]) => void;
  /** The window's own settings, which have nowhere else to be reached from. */
  onOpenSettings?: () => void;
  /** A file was opened from one of the explorer rows. */
  onOpenFile?: (path: string) => void;
}

/**
 * Reports `paths` whenever that set moves, and on no other render.
 *
 * Compared by value rather than by identity: the arrays are rebuilt on every
 * render, and a report is what the host turns into scans -- so a render that
 * did not move the set must not produce one.
 */
function useReport(paths: string[], report?: (paths: string[]) => void) {
  const latest = useRef(report);
  useEffect(() => {
    latest.current = report;
  }, [report]);

  const key = JSON.stringify(paths);
  useEffect(() => {
    latest.current?.(JSON.parse(key));
  }, [key]);
}

/**
 * The left hand column: a stack of independent explorers, one per folder that
 * is open, each browsing wherever it likes. Browsing is all it is -- a pane
 * reads the one directory it is showing, and walking into a folder costs that
 * and nothing more.
 *
 * Putting a folder on the graph is the other thing, and it is asked for: every
 * folder carries its own mark, and pressing it is what hands that folder over
 * to be scanned. Nothing is scanned because a pane happened to walk past it.
 */
export function FolderSidebar({
  initialFolders,
  onExpandedChange,
  onFoldersChange,
  onOpenSettings,
  onOpenFile,
}: FolderSidebarProps) {
  const { t } = useTranslation();
  const nextId = useRef(0);
  const [panes, setPanes] = useState<Pane[]>(() =>
    (initialFolders ?? []).map((path) => ({ id: nextId.current++, path, open: true, graphed: [] })),
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
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

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
    if (roots) return;
    // A machine that will not say where its drives are leaves the menu with
    // the places it already knows, which is usually all of them.
    listRoots()
      .then(setRoots)
      .catch(() => undefined);
  }

  /** Showing its rows from the start, and on the graph not at all: a folder is
   *  added in order to look through it, and looking through a folder full of
   *  repositories is not a request to read every one of them. */
  function addPane(path: string) {
    setAnchor(null);
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

  return (
    <Box
      ref={sidebar}
      sx={{
        position: "relative",
        width,
        flex: "none",
        display: "flex",
        flexDirection: "column",
        bgcolor: "background.paper",
        borderRight: 1,
        borderColor: "divider",
      }}
    >
      {/* The column's header: the two marks that answer for the sidebar itself
          rather than for any one folder in it.

          They stand in the band along the top of the window — the strip the
          window's own three marks are already in, at the other end of it — so
          the row reads as what the column does on the left and what the window
          does on the right, at one height. That band is the only row this
          window reserves, and it is reserved once for the whole of it rather
          than as a bar over the folders charged to every one of them: nothing
          is drawn here but the marks, no plate and no rule under them.

          The rest of the row is the sheet the window is picked up by. Behind
          the marks and not around them, as in `WindowControls` — a press inside
          an element carrying `data-tauri-drag-region` is a press on the window,
          so a button under one is a button that cannot be clicked. */}
      <Box sx={{ position: "relative", flex: "none", height: HEADER_HEIGHT }}>
        <Box data-tauri-drag-region sx={{ position: "absolute", inset: 0 }} />
        <Stack
          direction="row"
          spacing={0.25}
          sx={{
            position: "relative",
            height: "100%",
            // Sitting on the band's floor, which is where the window's own
            // marks sit: the two clusters line up across the window.
            alignItems: "flex-end",
            pl: `${HEADER_INSET}px`,
            // See-through in the gaps, so the sheet behind gets those presses.
            pointerEvents: "none",
            "& > *": { pointerEvents: "auto" },
          }}
        >
          <MarkButton label={t("folder.add")} onClick={openRootMenu}>
            <AddMark />
          </MarkButton>
          {onOpenSettings && (
            <MarkButton label={t("folder.settings")} onClick={onOpenSettings}>
              <SettingsMark />
            </MarkButton>
          )}
        </Stack>
      </Box>

      {/* Where a pane starts, not where it stays: the rest is browsing. */}
      <Menu
        open={anchor !== null}
        anchorEl={anchor}
        onClose={() => setAnchor(null)}
        slotProps={{ list: { dense: true } }}
      >
        {groupRoots(roots ?? []).flatMap((group, index) => [
          index > 0 ? <Divider key={`${group.kind}-rule`} sx={{ my: 0.5 }} /> : null,
          ...group.roots.map((root) => {
            const Icon = ROOT_ICONS[root.kind];
            return (
              <MenuItem key={root.path} onClick={() => addPane(root.path)}>
                <ListItemIcon sx={{ minWidth: 28 }}>
                  <Icon fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary={root.label}
                  slotProps={{ primary: { variant: "body2", noWrap: true } }}
                />
              </MenuItem>
            );
          }),
        ])}
      </Menu>

      {/* Scrolls, but draws no bar for it: the column is narrow, and a bar down
          the side of it took width from the names and put a second edge beside
          the one that is already there.

          No padding of its own: a folder's heading pins to the top of this box
          while its rows scroll under it, and any padding here would be a strip
          above the pinned heading that the rows show through. Each pane carries
          its own spacing instead. */}
      <Box
        ref={column}
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
          scrollbarWidth: "none",
          "&::-webkit-scrollbar": { display: "none" },
        }}
      >
        {panes.map((pane, index) => (
          <Box key={pane.id}>
            {index > 0 && <Divider />}
            <FolderPane
              path={pane.path}
              open={pane.open}
              graphed={pane.graphed}
              onNavigate={(path) => update(pane.id, { path })}
              onToggleOpen={() => update(pane.id, { open: !pane.open })}
              onToggleGraph={(path) => toggleGraph(pane.id, path)}
              onOpenFile={onOpenFile}
              onClose={() =>
                setPanes((current) => current.filter((candidate) => candidate.id !== pane.id))
              }
            />
          </Box>
        ))}

        {/* The window has no bar to be picked up by, so the column's own blank
            space is the handle: press below the folders to move the window,
            double click to fill the screen. Only the blank space — a press
            inside an element carrying this attribute is a press on the window,
            so a row under one would be a row that cannot be clicked. */}
        <Box data-tauri-drag-region sx={{ flex: 1, minHeight: 48 }} />
      </Box>

      {/* The grip between the two panes. */}
      <ResizeGrip label={t("resize.width")} {...grip} />
    </Box>
  );
}

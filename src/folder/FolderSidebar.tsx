import { Box, Divider, Stack } from "@mui/material";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { AddMark, MarkButton, SettingsMark } from "../components/marks";
import { ResizeGrip } from "../components/useResizeGrip";
import { HEADER_HEIGHT, HEADER_INSET } from "../components/WindowControls";
import { FolderPane } from "./FolderPane";
import { RootsMenu } from "./RootsMenu";
import { usePanes } from "./usePanes";

/** One explorer, and the identity that keeps two of them at the same place
 *  from being the same pane. */
export interface Pane {
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

/** A request from the canvas to browse a directory in the pane that put its
 *  root on the graph. The root identifies the pane; the path is where it goes. */
export interface FolderDestination {
  root: string;
  path: string;
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
  /** A graph node asked to move its owning pane to a folder. */
  destination?: FolderDestination | null;
}

/**
 * Reports `paths` whenever that set moves, and on no other render.
 *
 * Compared by value rather than by identity: the arrays are rebuilt on every
 * render, and a report is what the host turns into scans -- so a render that
 * did not move the set must not produce one.
 */
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
  destination,
}: FolderSidebarProps) {
  const { t } = useTranslation();
  const {
    panes,
    setPanes,
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
    update,
    toggleGraph,
    openRootMenu,
    closeRootMenu,
    addPane,
    dropPlace,
    keepTyped,
  } = usePanes(initialFolders ?? [], onFoldersChange, onExpandedChange, destination);

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
      {/* The column's header: the two marks that answer for the window itself
          rather than for any one folder in it — where a folder is added, and
          everything the window is set to, which opens as a page on the graph.

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

      {/* Where a pane starts, not where it stays: the rest is browsing.

          Three things, in the order a folder is looked for. The field at the
          top is for the folder that is named rather than found — anything a
          shell would take, `~` and all — and writing one out keeps it, so it is
          under the roots the next time this menu opens. Then the places the
          machine has, which are worked out every time and cannot be kept or
          dropped. Then the folders that were.

          `autoFocus` is off on the menu itself so the field has the caret from
          the moment it appears: the list is still there to be arrowed through
          once it is stepped into, and a menu that opens ready to be typed into
          is a menu that does not have to be aimed at first. */}
      <RootsMenu
        anchor={anchor}
        roots={roots}
        places={places}
        typed={typed}
        setTyped={setTyped}
        refused={refused}
        setRefused={setRefused}
        addPane={addPane}
        dropPlace={dropPlace}
        keepTyped={keepTyped}
        closeRootMenu={closeRootMenu}
      />

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
          <Box key={pane.id} data-folder-pane={pane.id}>
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

import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import {
  Box,
  Divider,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Stack,
  TextField,
} from "@mui/material";
import { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AddMark, CloseMark, MarkButton, SettingsMark } from "../components/marks";
import { ResizeGrip, useResizeGrip } from "../components/useResizeGrip";
import { HEADER_HEIGHT, HEADER_INSET } from "../components/WindowControls";
import { describeFolders, listRoots, type Place, type Root, resolveFolder } from "./api";
import { FolderPane } from "./FolderPane";
import { keepPlaces, keptPlaces } from "./places";
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
          everything the window is set to, which is a dialog and not a mark.

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
      <Menu
        open={anchor !== null}
        anchorEl={anchor}
        onClose={closeRootMenu}
        autoFocus={false}
        slotProps={{ list: { dense: true, sx: { minWidth: 240 } } }}
      >
        {/* Held here rather than let through: a menu answers a keystroke by
            jumping to the row it begins with, and every letter of a path would
            be one more jump out of the field it was typed in. */}
        <Box
          key="path"
          sx={{ px: 1.5, pt: 0.5, pb: 1 }}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <TextField
            autoFocus
            fullWidth
            size="small"
            variant="standard"
            value={typed}
            error={refused}
            placeholder={t("folder.pathHint")}
            helperText={refused ? t("folder.noFolder") : undefined}
            onChange={(event) => {
              setTyped(event.target.value);
              setRefused(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") keepTyped();
            }}
            slotProps={{ htmlInput: { spellCheck: false, "aria-label": t("folder.pathHint") } }}
          />
        </Box>

        {groupRoots(roots ?? []).flatMap((group) => [
          <Divider key={`${group.kind}-rule`} sx={{ my: 0.5 }} />,
          ...group.roots.map((root) => {
            const Icon = ROOT_ICONS[root.kind];
            return (
              <MenuItem key={root.path} onClick={() => addPane(root.path)}>
                <ListItemIcon sx={{ minWidth: 28 }}>
                  <Icon fontSize="small" />
                </ListItemIcon>
                <ListItemText
                  primary={root.label}
                  secondary={root.detail}
                  slotProps={{
                    primary: { variant: "body2", noWrap: true },
                    secondary: { variant: "caption", noWrap: true },
                  }}
                />
              </MenuItem>
            );
          }),
        ])}

        {/* The folders that were kept. Each carries the mark that drops it,
            which is at the end of the row where every other mark in this
            column is — and takes the press for itself, so dropping a folder is
            never also opening it. */}
        {(places ?? []).length > 0 && <Divider key="kept-rule" sx={{ my: 0.5 }} />}
        {(places ?? []).map((place) => (
          <MenuItem key={place.path} onClick={() => addPane(place.path)}>
            <ListItemIcon sx={{ minWidth: 28 }}>
              <FolderOutlinedIcon fontSize="small" />
            </ListItemIcon>
            <ListItemText
              primary={place.label}
              secondary={place.display}
              slotProps={{
                primary: { variant: "body2", noWrap: true },
                secondary: { variant: "caption", noWrap: true },
              }}
            />
            <Box sx={{ display: "flex", ml: 1 }}>
              <MarkButton
                label={t("folder.drop")}
                danger
                onClick={(event) => {
                  event.stopPropagation();
                  dropPlace(place.path);
                }}
              >
                <CloseMark />
              </MarkButton>
            </Box>
          </MenuItem>
        ))}
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

import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import LinkIcon from "@mui/icons-material/Link";
import { Box, ListItemButton, ListItemIcon, ListItemText, Stack } from "@mui/material";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { FolderMark, GraphMark, JumpMark, MarkButton } from "../components/marks";
import { FILE_DRAG_TYPE } from "../lib/filePreview";
import type { FsEntry, Listing } from "./api";
import { DROP_INTO } from "./dropInto";
import type { FileMenuTarget } from "./FileContextMenu";
import { isInside } from "./format";
import { MoreRows } from "./MoreRows";
import { NameField, type Naming } from "./NameField";
import {
  CHANGE_COLOUR,
  ICON,
  IGNORED_COLOUR,
  LEVEL_STEP,
  REFUSED_DROP,
  ROW_INDENT,
  TAKING_DROP,
} from "./rows";
import { useLevel } from "./useLevel";

interface LevelProps {
  path: string;
  /** The pane's top-level folder, for paths copied relative to it. */
  root: string;
  /** How far in the rows are drawn: one step per folder that was opened. */
  depth: number;
  graphed: readonly string[];
  selected: string | null;
  /** The folder a drop is landing in, and the one that would not take one.
   *  Either is a folder anywhere in the column, so every level is told both
   *  and the one row that is it draws itself as it. */
  dropping: string | null;
  refused: string | null;
  onOpen: (entry: FsEntry) => void;
  onNavigate: (path: string) => void;
  onToggleGraph: (path: string) => void;
  onOpenFile?: (path: string) => void;
  /** A row was right-clicked. The menu itself belongs to the column, so that
   *  one of them is open at a time however deep the rows go — and which pane
   *  the row is in is the pane's to say, not a level's. */
  onMenu: (target: Omit<FileMenuTarget, "pane">) => void;
  /** The name being typed in this pane, wherever in it that is. A level draws
   *  it when it is one of its own rows, and opens the folder on the way to it
   *  when it is deeper down. */
  naming: Naming | null;
  onNameDone: (name: string) => Promise<void>;
  onNameCancel: () => void;
  /** What this directory answered, for a caller that needs to know. */
  onListing?: (listing: Listing) => void;
}

/**
 * One directory's rows, and the levels opened underneath them.
 *
 * A level reads its own directory and watches its own directory, so opening a
 * folder costs one read of that folder and nothing else — however deep the tree
 * already is, and whatever is underneath what was opened. A change on disk
 * reaches the level that is showing the file and redraws that level alone.
 */
export function Level({
  path,
  root,
  depth,
  graphed,
  selected,
  dropping,
  refused,
  onOpen,
  onNavigate,
  onToggleGraph,
  onOpenFile,
  onMenu,
  naming,
  onNameDone,
  onNameCancel,
  onListing,
}: LevelProps) {
  const { t } = useTranslation();
  const {
    failed,
    expanded,
    setExpanded,
    rows,
    rest,
    shown,
    counts,
    changes,
    allIgnored,
    ignored,
    drawMore,
  } = useLevel(path, depth, onNavigate, onListing);

  /** Opening a folder is one more level under this one; closing takes it away. */
  function toggle(folder: string) {
    setExpanded((held) =>
      held.includes(folder) ? held.filter((one) => one !== folder) : [...held, folder],
    );
  }
  const indent = ROW_INDENT + depth * LEVEL_STEP;

  /* A name being typed in a folder that is not open yet opens it, one level per
     step down: the field is drawn among that folder's rows, and until it is
     open there are no such rows to draw it among. Checked on every render
     rather than against a list of dependencies, because the rows it looks
     through arrive at their own pace — and it does nothing at all once the
     folder on the way is open. */
  useEffect(() => {
    if (!naming || naming.folder === path) return;
    const step = rows.find((entry) => entry.isDir && isInside(entry.path, naming.folder));
    if (step && !expanded.includes(step.path)) setExpanded((held) => [...held, step.path]);
  });

  /** The row being made here, which is drawn at the top of this folder's rows:
   *  directly under the folder it is going into, where it is read as being in
   *  that folder and is in view without anything having to be scrolled. */
  const making = naming && !naming.path && naming.folder === path ? naming : null;

  return (
    <>
      {failed && <Box sx={{ mx: 1, my: 0.5, height: 2, borderRadius: 1, bgcolor: "error.main" }} />}

      {making && (
        <NameField
          key={making.kind}
          indent={indent}
          isDir={making.kind === "new-folder"}
          from=""
          placeholder={t(making.kind === "new-folder" ? "file.newFolder" : "file.newFile")}
          onDone={onNameDone}
          onCancel={onNameCancel}
        />
      )}

      {rows.map((entry) => {
        // A row being renamed is the field and nothing else: what is being
        // asked for is its name, and the marks beside a name answer for a row
        // that is called something.
        if (naming?.path === entry.path) {
          return (
            <Box key={entry.path}>
              <NameField
                indent={indent}
                isDir={entry.isDir}
                from={entry.name}
                placeholder={entry.name}
                onDone={onNameDone}
                onCancel={onNameCancel}
              />
            </Box>
          );
        }

        const open = expanded.includes(entry.path);
        // The whole of what a row says about git: a name in the colour of what
        // became of the file behind it, a faint one where git was told to leave
        // that file alone, and nothing at all when it is what the last commit
        // says it is. No badge and no second column — the listing is already a
        // list of names, and this is those names read again.
        //
        // A row that is both — a folder on the ignore list holding a tracked
        // file that moved — takes the colour. What became of a file is the
        // thing worth seeing, and being ignored is what a row says when it has
        // nothing else to say.
        const change = changes.get(entry.name);
        const dim = allIgnored || ignored.has(entry.name);
        const colour = change ? CHANGE_COLOUR[change] : dim ? IGNORED_COLOUR : undefined;
        // Where a drop on this row lands: inside the folder it names, or in the
        // directory listing it when it names a file — the same place its
        // context menu makes a new file. So a file's row is a destination too,
        // and the folder that would take it is the one that draws itself as
        // taking it, which is a row above this one or the pane's own heading.
        const into = entry.isDir ? entry.path : path;
        const mark = !entry.isDir
          ? null
          : entry.path === dropping
            ? TAKING_DROP
            : entry.path === refused
              ? REFUSED_DROP
              : null;
        return (
          <Box key={entry.path}>
            <ListItemButton
              selected={entry.path === selected}
              draggable={!entry.isDir}
              {...{ [DROP_INTO]: into }}
              sx={{ pl: indent, pr: 0.5, gap: 0.5, ...mark }}
              onDragStart={(event) => {
                if (entry.isDir) return;
                event.dataTransfer.effectAllowed = "copy";
                event.dataTransfer.setData(FILE_DRAG_TYPE, entry.path);
                event.dataTransfer.setData("text/plain", entry.path);
              }}
              onDoubleClick={(event) => {
                if (entry.isDir) return;
                event.stopPropagation();
                onOpen(entry);
                onOpenFile?.(entry.path);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                // The row answers for itself rather than letting the folder
                // around it answer: the menu is asked of what was pointed at.
                event.stopPropagation();
                onOpen(entry);
                onMenu({
                  path: entry.path,
                  name: entry.name,
                  isDir: entry.isDir,
                  // A folder is made into, and a file is made beside — which is
                  // the directory listing it, the one these rows are. The same
                  // folder a drop on this row lands in.
                  into,
                  root,
                  at: { x: event.clientX, y: event.clientY },
                });
              }}
              onClick={() => {
                onOpen(entry);
                // A folder opens where it is. Going to it is the mark beside
                // the name, and reading it is what that mark does not do.
                if (entry.isDir) toggle(entry.path);
              }}
            >
              {/* The same grey as a file's: a folder is told from a file by the
                  drawing, and a listing where one kind of row is coloured reads
                  as a listing of that kind with the rest around it. Colour is
                  spent on the other thing instead — the mark takes the name's
                  colour when git has something to say about the row, so the
                  whole row moves together and none of it moves for anything
                  else. */}
              <ListItemIcon sx={colour ? { ...ICON, color: colour } : ICON}>
                {/* Open or shut, which is the whole of what the row's own
                    click does — so the icon is where that is said. */}
                {entry.isDir ? (
                  <FolderMark on={open} />
                ) : (
                  <DescriptionOutlinedIcon fontSize="small" />
                )}
              </ListItemIcon>
              {/* The path belongs to the name, not to the whole row: a row that
                  carried it would hand the same tooltip to everything inside
                  it, and the marks at the far end would each answer twice. */}
              <ListItemText
                primary={entry.name}
                slotProps={{
                  primary: {
                    variant: "body2",
                    noWrap: true,
                    sx: colour ? { color: colour } : undefined,
                  },
                }}
              />
              {entry.isSymlink && <LinkIcon sx={{ fontSize: 12, color: "text.disabled" }} />}
              {/* Both offers at the right hand end, in the same order at every
                  level: go to this folder, and put it on the graph. Beside the
                  row rather than inside it, so a folder is reached — or drawn —
                  from where it is listed, without having to be walked into
                  first. Files have neither. */}
              {entry.isDir && (
                <Stack direction="row" sx={{ ml: "auto", flex: "none", gap: 0.25 }}>
                  <MarkButton
                    label={t("folder.enter")}
                    onClick={(event) => {
                      event.stopPropagation();
                      onNavigate(entry.path);
                    }}
                  >
                    <JumpMark />
                  </MarkButton>
                  <MarkButton
                    label={t("folder.graph")}
                    onClick={(event) => {
                      event.stopPropagation();
                      onToggleGraph(entry.path);
                    }}
                  >
                    <GraphMark
                      on={graphed.includes(entry.path)}
                      count={counts.get(entry.path) ?? 0}
                    />
                  </MarkButton>
                </Stack>
              )}
            </ListItemButton>

            {open && (
              <Level
                path={entry.path}
                root={root}
                depth={depth + 1}
                graphed={graphed}
                selected={selected}
                dropping={dropping}
                refused={refused}
                onOpen={onOpen}
                onNavigate={onNavigate}
                onToggleGraph={onToggleGraph}
                onOpenFile={onOpenFile}
                onMenu={onMenu}
                naming={naming}
                onNameDone={onNameDone}
                onNameCancel={onNameCancel}
              />
            )}
          </Box>
        );
      })}

      {/* Where the rest of the directory would be. Keyed by how much is drawn
          so that it is watched again after each chunk: a mark that is still in
          view when its rows arrive has not crossed anything, and an observer
          left on it would never speak again. */}
      {rest > 0 && <MoreRows key={shown} indent={indent} onSeen={drawMore} />}
    </>
  );
}

import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import LinkIcon from "@mui/icons-material/Link";
import { Box, ListItemButton, ListItemIcon, ListItemText, Stack } from "@mui/material";
import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { FsEntry, Listing } from "../../folder/api";
import { DROP_INTO } from "../../folder/dropInto";
import { isInside } from "../../folder/format";
import { FILE_DRAG_TYPE } from "../../lib/filePreview";
import { FolderMark, GitMark, GraphFolderMark, JumpMark, MarkButton, SIZE } from "../../marks";
import type { FileMenuTarget } from "./FileContextMenu";
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
  root: string;
  depth: number;
  graphed: readonly string[];
  selected: string | null;
  /** Anywhere in the column; every level is told, and the one row that is it draws itself. */
  dropping: string | null;
  refused: string | null;
  onOpen: (entry: FsEntry) => void;
  /** Absent under a repository's row: the files shown are read where they are, with no pane to move. */
  onNavigate?: (path: string) => void;
  /** Absent where a folder cannot go on the canvas; the row then has no mark for it. */
  onToggleGraph?: (path: string) => void;
  /**
   * Starts a pane listing the repositories under the folder: the git way onto the canvas. Offered
   * only by a folder that holds a repository; any folder goes on as a folder.
   */
  onListRepositories?: (path: string) => void;
  onOpenFile?: (path: string) => void;
  /** The menu belongs to the column so one is open at a time; the pane says which pane. */
  onMenu: (target: Omit<FileMenuTarget, "pane">) => void;
  /** Drawn by the level it is a row of; deeper down, the levels open the folder on the way. */
  naming: Naming | null;
  onNameDone: (name: string) => Promise<void>;
  onNameCancel: () => void;
  onListing?: (listing: Listing) => void;
}

/** A level reads and watches its own directory only, so opening a folder costs one read. */
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
  onListRepositories,
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
    changes,
    allIgnored,
    ignored,
    holding,
    drawMore,
  } = useLevel(path, depth, onNavigate, onListing, onListRepositories !== undefined);

  function toggle(folder: string) {
    setExpanded((held) =>
      held.includes(folder) ? held.filter((one) => one !== folder) : [...held, folder],
    );
  }
  const indent = ROW_INDENT + depth * LEVEL_STEP;

  // A name typed in a folder not yet open opens it one level per step; checked every render because
  // rows arrive at their own pace.
  useEffect(() => {
    if (!naming || naming.folder === path) return;
    const step = rows.find((entry) => entry.isDir && isInside(entry.path, naming.folder));
    if (step && !expanded.includes(step.path)) setExpanded((held) => [...held, step.path]);
  });

  /** Drawn at the top of this folder's rows, directly under the folder it goes into. */
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
        // A row being renamed is the field alone.
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
        // A row both ignored and changed takes the colour: what became of a file is worth more.
        const change = changes.get(entry.name);
        const dim = allIgnored || ignored.has(entry.name);
        const colour = change ? CHANGE_COLOUR[change] : dim ? IGNORED_COLOUR : undefined;
        // A file's row drops into the directory listing it, the same place its menu makes a new
        // file.
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
                // The row answers for itself: the menu is asked of what was pointed at.
                event.stopPropagation();
                onOpen(entry);
                onMenu({
                  path: entry.path,
                  name: entry.name,
                  isDir: entry.isDir,
                  into,
                  root,
                  at: { x: event.clientX, y: event.clientY },
                });
              }}
              onClick={() => {
                onOpen(entry);
                // A folder opens where it is; going to it is the mark beside the name.
                if (entry.isDir) toggle(entry.path);
              }}
            >
              <ListItemIcon sx={ICON}>
                {entry.isDir ? (
                  <FolderMark on={open} />
                ) : (
                  <DescriptionOutlinedIcon fontSize="small" />
                )}
              </ListItemIcon>
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
              {entry.isDir && (onNavigate || onToggleGraph || onListRepositories) && (
                <Stack direction="row" sx={{ ml: "auto", flex: "none", gap: 0.25 }}>
                  {onListRepositories && holding.has(entry.path) && (
                    <MarkButton
                      label={t("folder.listRepositories")}
                      onClick={(event) => {
                        event.stopPropagation();
                        onListRepositories(entry.path);
                      }}
                    >
                      <GitMark size={SIZE} />
                    </MarkButton>
                  )}
                  {onNavigate && (
                    <MarkButton
                      label={t("folder.enter")}
                      onClick={(event) => {
                        event.stopPropagation();
                        onNavigate(entry.path);
                      }}
                    >
                      <JumpMark />
                    </MarkButton>
                  )}
                  {onToggleGraph && (
                    <MarkButton
                      label={t("folder.graph")}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleGraph(entry.path);
                      }}
                    >
                      <GraphFolderMark on={graphed.includes(entry.path)} />
                    </MarkButton>
                  )}
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
                onListRepositories={onListRepositories}
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

      {rest > 0 && <MoreRows key={shown} indent={indent} onSeen={drawMore} />}
    </>
  );
}

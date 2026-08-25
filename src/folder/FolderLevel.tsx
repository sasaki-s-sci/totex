import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import LinkIcon from "@mui/icons-material/Link";
import { Box, ListItemButton, ListItemIcon, ListItemText, Stack } from "@mui/material";
import { useTranslation } from "react-i18next";
import { FolderMark, GraphMark, JumpMark, MarkButton } from "../components/marks";
import { FILE_DRAG_TYPE } from "../lib/filePreview";
import type { FsEntry, Listing } from "./api";
import { MoreRows } from "./MoreRows";
import { CHANGE_COLOUR, ICON, IGNORED_COLOUR, LEVEL_STEP, ROW_INDENT } from "./rows";
import { useLevel } from "./useLevel";

interface LevelProps {
  path: string;
  /** How far in the rows are drawn: one step per folder that was opened. */
  depth: number;
  graphed: readonly string[];
  selected: string | null;
  onOpen: (entry: FsEntry) => void;
  onNavigate: (path: string) => void;
  onToggleGraph: (path: string) => void;
  onOpenFile?: (path: string) => void;
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
  depth,
  graphed,
  selected,
  onOpen,
  onNavigate,
  onToggleGraph,
  onOpenFile,
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

  return (
    <>
      {failed && <Box sx={{ mx: 1, my: 0.5, height: 2, borderRadius: 1, bgcolor: "error.main" }} />}

      {rows.map((entry) => {
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
        return (
          <Box key={entry.path}>
            <ListItemButton
              selected={entry.path === selected}
              draggable={!entry.isDir}
              sx={{ pl: indent, pr: 0.5, gap: 0.5 }}
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
                depth={depth + 1}
                graphed={graphed}
                selected={selected}
                onOpen={onOpen}
                onNavigate={onNavigate}
                onToggleGraph={onToggleGraph}
                onOpenFile={onOpenFile}
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

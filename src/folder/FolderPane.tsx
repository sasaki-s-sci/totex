import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import LinkIcon from "@mui/icons-material/Link";
import { Box, ListItemButton, ListItemIcon, ListItemText, Stack, Typography } from "@mui/material";
import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CloseMark,
  DisclosureMark,
  FolderMark,
  GraphMark,
  JumpMark,
  MarkButton,
  UpMark,
} from "../components/marks";
import { FILE_DRAG_TYPE } from "../lib/filePreview";
import { type Change, type FsEntry, type Listing, readDirectory, repositoryCounts } from "./api";
import { refreshChanges, useDirectoryChanges } from "./changes";
import { baseName } from "./format";
import { ROOT_ICONS } from "./roots";
import { watchDirectory } from "./watch";

/** Small enough that a column of panes still reads as one list. */
const ICON = { minWidth: 22, color: "text.secondary" } as const;

/**
 * What a row is drawn in when its file is not what the last commit says it is.
 *
 * The three colours the branches on the graph carry on their rims — the scheme's
 * `added`, `changed` and `removed`, which is a file that has arrived, one that
 * has been rewritten and one that has gone — so the column and the canvas answer
 * the same question the same way, one in names and the other in shares of a
 * circle. Which three hues those actually are is the preset's to say; see
 * src/theme/scheme.ts. MUI's names for them are what `sx` takes.
 *
 * A folder is drawn in what everything underneath it comes to, which is how the
 * one colour a file has that is not on the disk any more is seen at all: a
 * deleted file has no row, and the folder it was in turns `removed`. A folder
 * whose contents disagree is `changed` — it has been rewritten, whatever each
 * file did.
 */
const CHANGE_COLOUR: Record<Change, string> = {
  added: "success.main",
  modified: "warning.main",
  deleted: "error.main",
};

/** Rows sit one step in from the folder the pane is showing. */
const ROW_INDENT = 2;

/** How far a folder's contents are set in from the folder itself. */
const LEVEL_STEP = 1.25;

/**
 * How many of a directory's rows are drawn before it has been scrolled through.
 *
 * A directory is as long as it is — the backend will hand over five thousand
 * entries, and it says so when it stops there — while a column shows about
 * thirty of them at a time. Every row is a button, an icon, a name and two
 * marks, so a folder like that was fifty thousand elements built to be scrolled
 * past. This is the first screenful and some room to move; the rest arrives as
 * it is scrolled to, a chunk at a time, and never at all for the folders that
 * are opened to look at one name.
 */
const FIRST_ROWS = 80;

/** How many more arrive each time the end of the rows comes into view. */
const MORE_ROWS = 160;

export interface FolderPaneProps {
  /** The folder the pane is showing. It asks to be moved; it does not move. */
  path: string;
  /** True while the rows under the name are shown. Display and nothing else:
   *  shutting a pane's rows says nothing about what the graph is drawing. */
  open: boolean;
  /** The folders this pane has put on the graph, so every row it draws can say
   *  whether it is one of them. */
  graphed: readonly string[];
  onNavigate: (path: string) => void;
  onToggleOpen: () => void;
  /** Puts one folder on the graph or takes it off. The only way onto it. */
  onToggleGraph: (path: string) => void;
  /** Opens a file from its row as a card on the canvas. */
  onOpenFile?: (path: string) => void;
  onClose: () => void;
}

/**
 * One explorer: a folder, and as much of what is under it as has been opened.
 *
 * A folder row opens where it stands — its contents appear underneath it, set
 * in a step — because that is what looking into a folder is, and a column that
 * replaces itself loses the place it was read from. Moving the pane to a folder
 * is the other thing, and it has its own mark: `jump` makes that folder the one
 * the pane is showing, which is how a deep tree is got out from under.
 *
 * The graph is separate again, and is asked for: every folder here carries a
 * mark for it, on the pane's own name and on each of its folder rows, and
 * pressing one hands that folder over to be scanned. A folder of twenty
 * repositories can be opened and walked through without reading any of them.
 *
 * Both marks sit at the right hand end of the row, in the same order at every
 * level, so a column of folders reads as one list of names with one pair of
 * offers down the side of it.
 */
export function FolderPane({
  path,
  open: showing,
  graphed,
  onNavigate,
  onToggleOpen,
  onToggleGraph,
  onOpenFile,
  onClose,
}: FolderPaneProps) {
  const { t } = useTranslation();
  // What the pane's own folder answered, for the heading and the way out. The
  // rows themselves belong to the level that read them.
  const [root, setRoot] = useState<Listing | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // How many repositories are in the pane's own folder, for the mark on its
  // heading.
  const repositories = useRepositoryCounts([path]).get(path) ?? 0;

  const name = root?.path === path ? root.name : baseName(path);
  const parent = root?.path === path ? root.parent : null;
  // Which machine the folder is on, when it is not this one. `/home/a` means
  // one thing in one distribution and another in the next, and the name on its
  // own says neither.
  const distro = root?.path === path ? root.distro : null;

  function open(entry: FsEntry) {
    setSelected(entry.path);
  }

  return (
    <Box component="section" sx={{ pb: 0.5 }}>
      {/* The folder the pane is showing, and the things that can be done to it.
          Marks and nothing else are drawn: the name is the pane's heading, not
          a bar across the top of one.

          It stays at the top of the column while its own rows scroll past
          underneath, and is pushed off by the next folder's heading when that
          one arrives — so whichever folder is being looked at always says which
          folder it is, and the folders below are always one scroll away rather
          than lost somewhere under a long listing. Its own background, because
          the rows go behind it. */}
      <Stack
        direction="row"
        sx={{
          position: "sticky",
          top: 0,
          zIndex: 2,
          bgcolor: "background.paper",
          alignItems: "center",
          gap: 0.25,
          pt: 0.5,
          pl: 1,
          pr: 0.5,
        }}
      >
        <Box
          component="button"
          type="button"
          onClick={onToggleOpen}
          sx={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: 0.75,
            px: 0,
            py: 0.5,
            border: "none",
            background: "none",
            color: "text.primary",
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          <DisclosureMark on={showing} />
          {distro && <DistroMark distro={distro} />}
          <Typography variant="body2" noWrap>
            {name}
          </Typography>
        </Box>
        <MarkButton label={t("folder.close")} onClick={onClose}>
          <CloseMark />
        </MarkButton>
        {/* The way out of the pane, next to the mark that shuts it: the two of
            them answer for where the pane is standing, which is what the
            heading says. It was the first of the rows and is not one of them —
            a row is something the folder holds, and the folder above it is not
            held by it. Only while the rows are showing: the folder above is
            read from the listing, and a folded pane has not read one. */}
        {showing && parent && (
          <MarkButton label={t("folder.up")} onClick={() => onNavigate(parent)}>
            <UpMark />
          </MarkButton>
        )}
        {/* Last in the row, which is where the same offer stands on every
            folder listed underneath: the way onto the graph is found at one
            end of the column whether it is asked of the pane's own folder or
            of one of its rows. */}
        <MarkButton label={t("folder.graph")} onClick={() => onToggleGraph(path)}>
          <GraphMark on={graphed.includes(path)} count={repositories} />
        </MarkButton>
      </Stack>

      {showing && (
        <Level
          path={path}
          depth={0}
          graphed={graphed}
          selected={selected}
          onOpen={open}
          onNavigate={onNavigate}
          onToggleGraph={onToggleGraph}
          onOpenFile={onOpenFile}
          onListing={setRoot}
        />
      )}
    </Box>
  );
}

/**
 * The mark for a folder that lives inside a WSL distribution.
 *
 * The same mark the rail puts beside that distribution's own row, so a pane
 * showing one of its folders is recognisably the same place the pane was
 * started from. It carries the distribution's name rather than saying it: the
 * window draws marks, and a name is only wanted when somebody asks for it.
 */
function DistroMark({ distro }: { distro: string }) {
  const Icon = ROOT_ICONS["wsl-distro"];
  return <Icon titleAccess={distro} sx={{ flex: "none", fontSize: 14, color: "text.secondary" }} />;
}

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
function Level({
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
  const [listing, setListing] = useState<Listing | null>(null);
  /** A directory that would not open. Drawn as a rule where its rows would be
   *  and nothing else: what is missing is the listing, which is what shows. */
  const [failed, setFailed] = useState(false);
  /** The folders in this directory that have been opened, by path. */
  const [expanded, setExpanded] = useState<readonly string[]>([]);
  /** How many of this directory's rows are drawn. See `FIRST_ROWS`. */
  const [shown, setShown] = useState(FIRST_ROWS);

  const rows = listing ? listing.entries.slice(0, shown) : [];
  const rest = listing ? listing.entries.length - rows.length : 0;

  // Which of the folders here are worth offering to the graph. Only the ones
  // that are drawn: the walk behind this answer is a walk per folder, and a
  // directory of three thousand of them would send three thousand of them out
  // for rows nobody has scrolled to. Asked again as more are drawn, and only
  // ever about the ones that have not been asked about — a file written in this
  // directory re-reads it, and a re-read must not send the walk out again for
  // an answer that cannot have moved.
  const folders = rows.filter((entry) => entry.isDir).map((entry) => entry.path);
  const counts = useRepositoryCounts(folders);

  // What is uncommitted here, by the name of the row it belongs to. Read for
  // this directory alone and shared with nobody: a level draws its own rows,
  // and a folder further down is answered for by the level showing it.
  const changes = useDirectoryChanges(path);

  /** Draws the next chunk of rows, out of whatever room the frame has. */
  const drawMore = useCallback(() => {
    startTransition(() => setShown((count) => count + MORE_ROWS));
  }, []);

  // Read rather than captured: a reading redirects the pane to the path that
  // answered, and re-reading the directory because a handler changed identity
  // is not what that is for.
  const report = useRef({ onNavigate, onListing });
  report.current = { onNavigate, onListing };

  useEffect(() => {
    let cancelled = false;

    // Only the first reading empties the level. A re-read after something moved
    // replaces the rows in place: the directory is on screen and being looked
    // at, and blanking it would be a flicker for one changed row.
    const read = (announce: boolean) => {
      if (announce) {
        setListing(null);
        setFailed(false);
        setShown(FIRST_ROWS);
      }
      // Everything the directory holds, hidden entries included: there is no
      // toggle to turn them back on, so they are shown like the rest. The
      // leading dot is what says a file is hidden, and it is already in the
      // name — a row drawn fainter than its neighbours says the second, weaker
      // thing instead: that it is somehow less of a file.
      readDirectory(path, true)
        .then((next) => {
          if (cancelled) return;
          setListing(next);
          setFailed(false);
          report.current.onListing?.(next);
          // `~`, `..` and the legacy WSL share are all folded by the backend, so
          // the pane moves to the path that actually answered — which is the one
          // worth watching, and the one the graph would be handed. Only the
          // pane's own folder: every level under it was named by a listing that
          // had already been folded.
          if (depth === 0 && next.path !== path) report.current.onNavigate(next.path);
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    };

    read(true);
    // Watched for as long as this level is on screen, so a worktree removed —
    // or a file written by whatever is running in the panel — leaves the pane
    // as soon as it leaves the disk. What is uncommitted moved with it, and is
    // read again on the back of the same event rather than waiting for its own
    // clock: a file saved in the panel is a row that turns orange as it is
    // saved.
    const stop = watchDirectory(path, () => {
      read(false);
      refreshChanges();
    });

    return () => {
      cancelled = true;
      stop();
    };
  }, [path, depth]);

  /** Opens a folder where it stands, or shuts it again. */
  function toggle(folder: string) {
    setExpanded((current) =>
      current.includes(folder) ? current.filter((held) => held !== folder) : [...current, folder],
    );
  }

  const indent = ROW_INDENT + depth * LEVEL_STEP;

  return (
    <>
      {failed && <Box sx={{ mx: 1, my: 0.5, height: 2, borderRadius: 1, bgcolor: "error.main" }} />}

      {rows.map((entry) => {
        const open = expanded.includes(entry.path);
        // The whole of what a row says about git: a name in the colour of what
        // became of the file behind it, and nothing at all when it is what the
        // last commit says it is. No badge and no second column — the listing
        // is already a list of names, and this is those names read again.
        const change = changes.get(entry.name);
        const colour = change && CHANGE_COLOUR[change];
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
      {rest > 0 && <More key={shown} indent={indent} onSeen={drawMore} />}
    </>
  );
}

/**
 * Where the rows that have not been drawn yet begin.
 *
 * Nothing is asked of whoever is reading: coming near it is the request, and
 * the rows are built out of a frame the window has to spare rather than the one
 * the scroll is in — see `drawMore`. The margin is what keeps it ahead of the
 * scroll, so what arrives has arrived before it is looked at.
 */
function More({ indent, onSeen }: { indent: number; onSeen: () => void }) {
  const mark = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const element = mark.current;
    if (!element) return;
    const watch = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) onSeen();
      },
      { rootMargin: "320px" },
    );
    watch.observe(element);
    return () => watch.disconnect();
  }, [onSeen]);

  // A rule where the next rows will be, and no more than that: it is not
  // pressed and it is not read, it is only what the scroll has to reach.
  return (
    <Box ref={mark} sx={{ pl: indent, py: 0.5 }}>
      <Box sx={{ width: 20, borderTop: "2px dotted", borderColor: "text.disabled" }} />
    </Box>
  );
}

/**
 * How many repositories each of `paths` holds, as far as the backend has been
 * asked.
 *
 * Nothing turns on this but the number on the graph mark — every folder can be
 * put on the graph, repository or not — so it is read for what it says rather
 * than for what it allows.
 *
 * Empty until the answer comes back, so the numbers appear rather than
 * disappearing: the walk behind them takes a moment on a folder that has none,
 * and a mark that shows and then goes away reads as something having gone
 * wrong.
 */
function useRepositoryCounts(paths: readonly string[]): ReadonlyMap<string, number> {
  const [counts, setCounts] = useState<ReadonlyMap<string, number>>(EMPTY);
  /** What has already been sent out, so that scrolling only asks about rows
   *  that have just appeared. */
  const asked = useRef(new Set<string>());
  // The paths themselves are what the answer depends on; the array they arrive
  // in is rebuilt on every render.
  const key = paths.join("\n");

  useEffect(() => {
    const wanted = (key ? key.split("\n") : []).filter((path) => !asked.current.has(path));
    if (wanted.length === 0) return;
    for (const path of wanted) asked.current.add(path);

    let cancelled = false;
    let settled = false;
    repositoryCounts(wanted)
      .then((found) => {
        if (cancelled) return;
        settled = true;
        const entries = Object.entries(found);
        if (entries.length === 0) return;
        // The answers are kept together rather than replaced: they arrive a
        // chunk of rows at a time, and a map rebuilt from the last chunk would
        // take the numbers off every row above it.
        startTransition(() => setCounts((held) => new Map([...held, ...entries])));
      })
      .catch(() => {
        // A folder whose answer never came is asked about again the next time
        // its listing is read.
        for (const path of wanted) asked.current.delete(path);
      });

    return () => {
      cancelled = true;
      // Strict Mode replays a newly mounted effect. An unanswered request must
      // become askable again for the replay rather than being left as checked
      // when its result is deliberately ignored by this cleanup.
      if (!settled) {
        for (const path of wanted) asked.current.delete(path);
      }
    };
  }, [key]);

  return counts;
}

const EMPTY: ReadonlyMap<string, number> = new Map();

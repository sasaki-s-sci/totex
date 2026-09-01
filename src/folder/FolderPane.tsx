import { Box, Stack, Typography } from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CloseMark, GraphMark, MarkButton, PaneFolderMark, UpMark } from "../components/marks";
import type { FsEntry, Listing } from "./api";
import { useRepositoryCounts } from "./counts";
import { DROP_INTO } from "./dropInto";
import type { FileMenuTarget } from "./FileContextMenu";
import { Level } from "./FolderLevel";
import { baseName } from "./format";
import { REFUSED_DROP, TAKING_DROP } from "./rows";

export interface FolderPaneProps {
  /** The folder the pane is showing. It asks to be moved; it does not move. */
  path: string;
  /** True while the rows under the name are shown. Display and nothing else:
   *  shutting a pane's rows says nothing about what the graph is drawing. */
  open: boolean;
  /** The folders this pane has put on the graph, so every row it draws can say
   *  whether it is one of them. */
  graphed: readonly string[];
  /** The folder a drop is landing in, and the one that would not take one.
   *  Both are the column's answer, and every pane draws whichever of its own
   *  folders is named — its heading included. */
  dropping: string | null;
  refused: string | null;
  onNavigate: (path: string) => void;
  onToggleOpen: () => void;
  /** Puts one folder on the graph or takes it off. The only way onto it. */
  onToggleGraph: (path: string) => void;
  /** Opens a file from its row as a card on the canvas. */
  onOpenFile?: (path: string) => void;
  /** Something in the pane was right-clicked. The column holds the menu. */
  onMenu: (target: FileMenuTarget) => void;
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
  dropping,
  refused,
  onNavigate,
  onToggleOpen,
  onToggleGraph,
  onOpenFile,
  onMenu,
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
    /* Anything in the pane that is not a row answers for the pane's own folder:
       its heading, and the space under the last row. A row stops the press
       before it gets here, so what a right-click offers is always what it was
       aimed at — and there is nowhere in the column that offers nothing. */
    <Box
      component="section"
      sx={{ pb: 0.5 }}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu({
          path,
          name,
          isDir: true,
          into: path,
          root: path,
          at: { x: event.clientX, y: event.clientY },
        });
      }}
    >
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
        {...{ [DROP_INTO]: path }}
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
          ...(path === dropping ? TAKING_DROP : path === refused ? REFUSED_DROP : null),
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
          {/* A folder, filled, and never anything else: the rows below draw
              the same folder hollow, so the heading is the solid one. It does
              not answer for whether those rows are showing — that was a
              chevron, and a chevron over a heading is an offer to unfold a step
              of a tree, which is not what the folder a pane is standing in is.

              Which machine the folder is on hangs off the name rather than
              standing beside it as a second mark: `/home/a` means one thing in
              one distribution and another in the next, and a heading is one
              folder and one drawing of it. */}
          <PaneFolderMark />
          <Typography variant="body2" noWrap title={distro ?? undefined}>
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
          root={path}
          depth={0}
          graphed={graphed}
          selected={selected}
          dropping={dropping}
          refused={refused}
          onOpen={open}
          onNavigate={onNavigate}
          onToggleGraph={onToggleGraph}
          onOpenFile={onOpenFile}
          onMenu={onMenu}
          onListing={setRoot}
        />
      )}
    </Box>
  );
}

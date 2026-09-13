import { Box, Stack, Typography } from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { FsEntry, Listing } from "../../folder/api";
import { useDirectoryChanges } from "../../folder/changes";
import { DROP_INTO } from "../../folder/dropInto";
import { baseName } from "../../folder/format";
import { useSpace } from "../../lib/space";
import { CloseMark, GraphMark, MarkButton, McpMark, PaneFolderMark, UpMark } from "../../marks";
import { useRepositoryCounts } from "./counts";
import type { FileMenuTarget } from "./FileContextMenu";
import { Level } from "./FolderLevel";
import type { Naming } from "./NameField";
import { CHANGE_COLOUR, REFUSED_DROP, TAKING_DROP } from "./rows";

export interface FolderPaneProps {
  /** Two panes can show one folder, so a row is named by pane as well as path. */
  id: number;
  /** The pane asks to be moved; it does not move itself. */
  path: string;
  /** Display only: shutting the rows says nothing about the graph. */
  open: boolean;
  graphed: readonly string[];
  dropping: string | null;
  refused: string | null;
  onNavigate: (path: string) => void;
  onToggleOpen: () => void;
  /** The only way onto the graph. */
  onToggleGraph: (path: string) => void;
  onOpenFile?: (path: string) => void;
  onMenu: (target: FileMenuTarget) => void;
  /** Held by the column, like the menu; see `Naming`. */
  naming: Naming | null;
  onNameDone: (name: string) => Promise<void>;
  onNameCancel: () => void;
  onClose: () => void;
}

/**
 * A folder row opens in place; `jump` moves the pane there. The graph is separate and asked for by
 * its own mark.
 */
export function FolderPane({
  id,
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
  naming,
  onNameDone,
  onNameCancel,
  onClose,
}: FolderPaneProps) {
  const { t } = useTranslation();
  const [root, setRoot] = useState<Listing | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const repositories = useRepositoryCounts([path]).get(path) ?? 0;
  // The space this pane stands in, which is rarely this folder: a pane inside a checkout stands in
  // the space at its root.
  const { standing, tell } = useSpace(path);

  const name = root?.path === path ? root.name : baseName(path);
  const parent = root?.path === path ? root.parent : null;
  // `/home/a` means one thing per distribution, so the name alone says nothing.
  const distro = root?.path === path ? root.distro : null;
  const answer = useDirectoryChanges(path);
  const isRepository = root?.path === path && root.entries.some((entry) => entry.name === ".git");
  const changes = isRepository ? Object.values(answer.changed) : [];
  const change = changes.reduce<(typeof changes)[number] | undefined>(
    (held, next) => (held === undefined || held === next ? next : "modified"),
    undefined,
  );
  const colour = change ? CHANGE_COLOUR[change] : "text.primary";

  function open(entry: FsEntry) {
    setSelected(entry.path);
  }

  return (
    /* Anything that is not a row answers for the pane's own folder; a row stops the press first. */
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
          pane: id,
          at: { x: event.clientX, y: event.clientY },
        });
      }}
    >
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
          <PaneFolderMark />
          <Typography variant="body2" noWrap title={distro ?? undefined} sx={{ color: colour }}>
            {name}
          </Typography>
        </Box>
        <MarkButton label={t("folder.close")} onClick={onClose}>
          <CloseMark />
        </MarkButton>
        {showing && parent && (
          <MarkButton label={t("folder.up")} onClick={() => onNavigate(parent)}>
            <UpMark />
          </MarkButton>
        )}
        {standing && (
          <MarkButton
            label={t("folder.door", { space: baseName(standing.space) })}
            onClick={() => tell({ ...standing.settings, mcp: !standing.settings.mcp })}
          >
            <McpMark on={standing.settings.mcp} />
          </MarkButton>
        )}
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
          // The levels below know nothing about which pane draws them.
          onMenu={(target) => onMenu({ ...target, pane: id })}
          naming={naming}
          onNameDone={onNameDone}
          onNameCancel={onNameCancel}
          onListing={setRoot}
        />
      )}
    </Box>
  );
}

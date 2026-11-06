import { Box, Stack, Typography } from "@mui/material";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useDirectoryChanges } from "../../folder/changes";
import { DROP_INTO } from "../../folder/dropInto";
import { baseName, displayPath } from "../../folder/format";
import { useSpace } from "../../lib/space";
import {
  AddMark,
  CanvasButton,
  CloseMark,
  GitMark,
  MarkButton,
  McpMark,
  PaneFolderMark,
  UpMark,
} from "../../marks";
import type { PaneGrip } from "./paneOrder";
import { CHANGE_COLOUR, PANE_ROW, REFUSED_DROP, TAKING_DROP } from "./rows";
import { usePaneRoot } from "./usePaneRoot";

export function PaneHeader({
  path,
  name: givenName,
  kind,
  open,
  graphed,
  dropping,
  refused,
  caption,
  grip,
  onSwitchMode,
  onToggleOpen,
  onToggleGraph,
  onAddFolder,
  onNavigate,
  onClose,
}: {
  path: string;
  name?: string;
  kind: "folder" | "repository";
  open: boolean;
  graphed: boolean;
  dropping: string | null;
  refused: string | null;
  caption?: ReactNode;
  grip?: PaneGrip;
  onSwitchMode: () => void;
  onToggleOpen: () => void;
  onToggleGraph: () => void;
  onAddFolder: (path: string) => void;
  onNavigate: (path: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const { root } = usePaneRoot(path);
  const { standing, tell } = useSpace(path);
  const answer = useDirectoryChanges(path);
  const changes = Object.values(answer.changed);
  const change = changes.reduce<(typeof changes)[number] | undefined>(
    (held, next) => (held === undefined || held === next ? next : "modified"),
    undefined,
  );
  const git = kind === "repository";
  const checkout = root?.entries.some((entry) => entry.name === ".git" && entry.isDir);
  const parent = root?.parent;
  const name = givenName ?? root?.name ?? baseName(path);
  const switchable = git || checkout;

  return (
    <Stack
      direction="row"
      {...grip}
      {...{ [DROP_INTO]: path }}
      sx={{
        position: "sticky",
        top: 0,
        zIndex: 2,
        bgcolor: "background.paper",
        alignItems: "center",
        gap: 0.25,
        ...PANE_ROW,
        pl: 1,
        pr: 0.5,
        "&:hover .pane__close, &:focus-within .pane__close": {
          opacity: 1,
          pointerEvents: "auto",
        },
        ...(path === dropping ? TAKING_DROP : path === refused ? REFUSED_DROP : null),
      }}
    >
      <MarkButton
        label={switchable ? t(git ? "repository.folderMode" : "folder.gitMode") : name}
        onClick={switchable ? onSwitchMode : onToggleOpen}
      >
        {git ? <GitMark on={open} /> : <PaneFolderMark git={checkout} />}
      </MarkButton>
      <Box
        component="button"
        type="button"
        aria-expanded={open}
        onClick={onToggleOpen}
        sx={{
          flex: 1,
          minWidth: 0,
          display: "flex",
          alignItems: "baseline",
          gap: 0.75,
          p: 0,
          border: "none",
          background: "none",
          color: change ? CHANGE_COLOUR[change] : "text.primary",
          cursor: "pointer",
          textAlign: "left",
          overflowX: "auto",
          whiteSpace: "nowrap",
          scrollbarWidth: "none",
        }}
      >
        <Typography variant="body2" title={root?.distro ?? displayPath(path)} sx={{ flex: "none" }}>
          {name}
        </Typography>
        {caption}
      </Box>
      <MarkButton label={t("folder.addPane")} onClick={() => onAddFolder(path)}>
        <AddMark />
      </MarkButton>
      <MarkButton
        label={t("folder.door", { space: baseName(standing?.space ?? path) })}
        disabled={!standing}
        aria-pressed={standing?.settings.mcp ?? false}
        onClick={() => standing && tell({ ...standing.settings, mcp: !standing.settings.mcp })}
      >
        <McpMark on={standing?.settings.mcp ?? false} />
      </MarkButton>
      <MarkButton
        label={t("folder.up")}
        disabled={!parent}
        onClick={() => parent && onNavigate(parent)}
      >
        <UpMark />
      </MarkButton>
      <CanvasButton
        label={t(git ? (graphed ? "repository.ungraph" : "repository.graph") : "folder.graph")}
        on={graphed}
        onClick={onToggleGraph}
      />
      <Box className="pane__close" sx={{ opacity: 0, pointerEvents: "none" }}>
        <MarkButton label={t(git ? "repository.remove" : "folder.remove")} onClick={onClose}>
          <CloseMark />
        </MarkButton>
      </Box>
    </Stack>
  );
}

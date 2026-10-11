import {
  Box,
  LinearProgress,
  ListItemButton,
  ListItemIcon,
  Stack,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { readFileHead } from "../../folder/api";
import { DROP_INTO } from "../../folder/dropInto";
import { baseName, displayPath } from "../../folder/format";
import { Frame, GitMark, GraphRepoMark, MarkButton, PaneRepoMark, UpMark } from "../../marks";
import type { FileMenuTarget } from "./FileContextMenu";
import { Level } from "./FolderLevel";
import type { Naming } from "./NameField";
import type { PaneGrip } from "./paneOrder";
import { ICON, PANE_ROW, REFUSED_DROP, ROW_INDENT, TAKING_DROP } from "./rows";
import { useSelection } from "./selection";
import { useRepositoryList } from "./useRepositoryList";

export interface RepoPaneProps {
  /** Two panes can list one root, so a row is named by pane as well as path. */
  id: number;
  /** The root listed under; the pane never moves. */
  path: string;
  /** Display only: shutting the rows says nothing about the graph. */
  open: boolean;
  graphed: readonly string[];
  /** Rows opened out to their files, by repository path. */
  expanded: readonly string[];
  /** The worktree a row shows in place of the repository's own folder, by repository path. */
  shown: Readonly<Record<string, string>>;
  /** Worktree path to the branch it is on, for the row's caption. */
  branches: ReadonlyMap<string, string>;
  dropping: string | null;
  refused: string | null;
  onToggleOpen: () => void;
  /** The only way onto the graph, and as a repository: it alone is scanned. */
  onToggleGraph: (repository: string) => void;
  onToggleExpanded: (repository: string) => void;
  /** `null` puts the row back on the repository's own folder. */
  onShowWorktree: (repository: string, path: string | null) => void;
  /** The whole list, once a walk has ended with nothing cut short: what the rows are now. */
  onListed: (repositories: string[]) => void;
  /** The pane turns back into the folder pane on the checkout it lists alone. */
  onFolderMode: () => void;
  onOpenFile?: (path: string) => void;
  onMenu: (target: FileMenuTarget) => void;
  /** Held by the column, like the menu; see `Naming`. */
  naming: Naming | null;
  onNameDone: (name: string) => Promise<void>;
  onNameCancel: () => void;
  onClose: () => void;
  /** Picks the pane up by its header, or by its one row when it has no header. */
  grip?: PaneGrip;
}

/** A mark that is a button and looks like none: it keeps the colour of whatever holds it. */
const BARE_BUTTON = {
  flex: "none",
  display: "flex",
  p: 0,
  border: "none",
  background: "none",
  color: "inherit",
  cursor: "pointer",
} as const;

/** A row's level can put nothing on the canvas: the row is what goes there. */
const NOTHING_GRAPHED: readonly string[] = [];

/**
 * A row is a repository and stays one: what it shows may be swapped for one of its worktrees, but
 * the row is named by the repository's own folder, so the reference outlives the swap.
 */
export function RepoPane({
  id,
  path,
  open: showing,
  graphed,
  expanded,
  shown,
  branches,
  dropping,
  refused,
  onToggleOpen,
  onToggleGraph,
  onToggleExpanded,
  onShowWorktree,
  onListed,
  onFolderMode,
  onOpenFile,
  onMenu,
  naming,
  onNameDone,
  onNameCancel,
  onClose,
  grip,
}: RepoPaneProps) {
  const { t } = useTranslation();
  const { rows, listing, failed, truncated } = useRepositoryList(path, onListed);
  const { selected, pick, point } = useSelection();
  const name = baseName(path);
  // A root that is a repository lists itself and nothing else: the row says all the header would,
  // so it stands alone and takes the header's close.
  const alone = rows.length === 1 && rows[0].path === path;

  return (
    <Box component="section" sx={{ position: "relative", pb: 0.5 }}>
      {!alone && (
        <Stack
          direction="row"
          {...grip}
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
          }}
        >
          {/* The mark is the way back, as the folder pane's checkout mark is the way here. */}
          <Box
            component="button"
            type="button"
            aria-label={t("repository.folderMode")}
            title={t("repository.folderMode")}
            onClick={onFolderMode}
            sx={{ ...BARE_BUTTON, mr: 0.75, color: "text.primary" }}
          >
            <PaneRepoMark />
          </Box>
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
              py: 0,
              border: "none",
              background: "none",
              color: "text.primary",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <Typography variant="body2" noWrap title={displayPath(path)}>
              {name}
            </Typography>
          </Box>
          <Box className="pane__close" sx={{ opacity: 0, pointerEvents: "none" }}>
            <MarkButton label={t("repository.remove")} onClick={onClose}>
              <Frame>
                <path d="M6 6l12 12M18 6L6 18" />
              </Frame>
            </MarkButton>
          </Box>
        </Stack>
      )}

      {/* Overlay the header's lower edge so a walk does not change the pane's height. */}
      {listing ? (
        <LinearProgress
          aria-label={t("repository.listing")}
          sx={{
            position: "absolute",
            top: PANE_ROW.height - 2,
            left: 8,
            right: 8,
            zIndex: 3,
            height: 2,
          }}
        />
      ) : failed ? (
        <Box
          sx={{
            position: "absolute",
            top: PANE_ROW.height - 2,
            left: 8,
            right: 8,
            zIndex: 3,
            height: 2,
            borderRadius: 1,
            bgcolor: "error.main",
          }}
        />
      ) : null}

      {(showing || alone) && (
        <>
          {rows.map((repository) => {
            const opened = expanded.includes(repository.path);
            const reading = shown[repository.path] ?? repository.path;
            const swapped = reading !== repository.path;
            const mark =
              reading === dropping ? TAKING_DROP : reading === refused ? REFUSED_DROP : null;
            return (
              <Box key={repository.path}>
                <ListItemButton
                  {...(alone ? grip : null)}
                  data-repo-row={`${id}:${repository.path}`}
                  {...{ [DROP_INTO]: reading }}
                  sx={{
                    pl: alone ? 1 : ROW_INDENT,
                    pr: 0.5,
                    gap: 0.5,
                    ...(alone ? PANE_ROW : null),
                    ...mark,
                    "&:hover .pane__close, &:focus-within .pane__close": {
                      opacity: 1,
                      pointerEvents: "auto",
                    },
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onMenu({
                      path: reading,
                      paths: [reading],
                      name: repository.name,
                      isDir: true,
                      into: reading,
                      root: reading,
                      pane: id,
                      at: { x: event.clientX, y: event.clientY },
                    });
                  }}
                  onClick={() => onToggleExpanded(repository.path)}
                >
                  <ListItemIcon sx={ICON}>
                    {/* Alone, the row stands for the header, and its mark for the header's. */}
                    {alone ? (
                      <Box
                        component="button"
                        type="button"
                        aria-label={t("repository.folderMode")}
                        title={t("repository.folderMode")}
                        onClick={(event) => {
                          event.stopPropagation();
                          onFolderMode();
                        }}
                        sx={BARE_BUTTON}
                      >
                        <GitMark on={opened} />
                      </Box>
                    ) : (
                      <GitMark on={opened} />
                    )}
                  </ListItemIcon>
                  <Stack
                    direction="row"
                    sx={{ flex: 1, minWidth: 0, alignItems: "baseline", gap: 0.75 }}
                  >
                    <Typography
                      variant="body2"
                      noWrap
                      title={displayPath(repository.path)}
                      sx={{ minWidth: 0 }}
                    >
                      {repository.name}
                    </Typography>
                    <BranchCaption path={reading} known={branches.get(reading)} swapped={swapped} />
                  </Stack>
                  <Stack
                    direction="row"
                    sx={{ ml: "auto", flex: "none", alignItems: "center", gap: 0.25 }}
                  >
                    {swapped && (
                      <MarkButton
                        label={t("repository.home")}
                        onClick={(event) => {
                          event.stopPropagation();
                          onShowWorktree(repository.path, null);
                        }}
                      >
                        <UpMark />
                      </MarkButton>
                    )}
                    <MarkButton
                      label={t(
                        graphed.includes(repository.path)
                          ? "repository.ungraph"
                          : "repository.graph",
                      )}
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggleGraph(repository.path);
                      }}
                    >
                      <GraphRepoMark on={graphed.includes(repository.path)} />
                    </MarkButton>
                    {alone && (
                      <Box className="pane__close" sx={{ opacity: 0, pointerEvents: "none" }}>
                        <MarkButton
                          label={t("repository.remove")}
                          onClick={(event) => {
                            event.stopPropagation();
                            onClose();
                          }}
                        >
                          <Frame>
                            <path d="M6 6l12 12M18 6L6 18" />
                          </Frame>
                        </MarkButton>
                      </Box>
                    )}
                  </Stack>
                </ListItemButton>

                {opened && (
                  <Level
                    path={reading}
                    root={reading}
                    depth={1}
                    graphed={NOTHING_GRAPHED}
                    selected={selected}
                    dropping={dropping}
                    refused={refused}
                    onPick={pick}
                    onPoint={point}
                    onOpenFile={onOpenFile}
                    // The levels below know nothing about which pane draws them.
                    onMenu={(target) => onMenu({ ...target, pane: id })}
                    naming={naming}
                    onNameDone={onNameDone}
                    onNameCancel={onNameCancel}
                  />
                )}
              </Box>
            );
          })}

          {truncated && (
            <Typography
              variant="caption"
              sx={{ display: "block", px: 2, py: 0.5, color: "text.secondary" }}
            >
              {t("repository.cutShort")}
            </Typography>
          )}
          {!listing && !failed && rows.length === 0 && (
            <Typography
              variant="caption"
              sx={{ display: "block", px: 2, py: 0.5, color: "text.secondary" }}
            >
              {t("repository.none")}
            </Typography>
          )}
        </>
      )}
    </Box>
  );
}

/** `ref: refs/heads/<branch>`, as a checkout's own `.git/HEAD` spells the branch it is on. */
const HEAD_REF = /^ref: refs\/heads\/(.+)$/m;

/**
 * The branch checked out at `path`, small beside the row's name. The window knows it for a
 * repository on the canvas; for the rest the checkout's `HEAD` is read, which costs no git. A
 * detached or unreadable `HEAD` leaves the caption out, unless the row shows a worktree: that one
 * goes by its folder.
 */
function BranchCaption({
  path,
  known,
  swapped,
}: {
  path: string;
  known: string | undefined;
  swapped: boolean;
}) {
  const { t } = useTranslation();
  const [read, setRead] = useState<{ path: string; branch: string } | null>(null);

  useEffect(() => {
    if (known !== undefined) return;
    let stale = false;
    const separator = path.includes("\\") && !path.includes("/") ? "\\" : "/";
    readFileHead(`${path.replace(/[\\/]+$/, "")}${separator}.git${separator}HEAD`)
      .then((head) => {
        const branch = head.text?.match(HEAD_REF)?.[1]?.trim();
        if (!stale && branch) setRead({ path, branch });
      })
      .catch(() => undefined);
    return () => {
      stale = true;
    };
  }, [path, known]);

  const reference =
    known ?? (read?.path === path ? read.branch : undefined) ?? (swapped ? baseName(path) : null);
  const branch = reference?.replace(/^refs\/heads\//, "");
  if (!branch) return null;
  return (
    <Typography
      variant="caption"
      noWrap
      title={swapped ? t("repository.showing", { branch }) : branch}
      sx={{ minWidth: 0, color: "text.secondary", fontSize: "0.68rem", lineHeight: 1.2 }}
    >
      {branch}
    </Typography>
  );
}

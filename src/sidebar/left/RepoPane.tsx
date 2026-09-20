import {
  Box,
  LinearProgress,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Typography,
} from "@mui/material";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { type FsEntry, readFileHead } from "../../folder/api";
import { DROP_INTO } from "../../folder/dropInto";
import { baseName, displayPath } from "../../folder/format";
import { CloseMark, GitMark, GraphRepoMark, MarkButton, PaneRepoMark, UpMark } from "../../marks";
import type { FileMenuTarget } from "./FileContextMenu";
import { Level } from "./FolderLevel";
import type { Naming } from "./NameField";
import { ICON, REFUSED_DROP, ROW_INDENT, TAKING_DROP } from "./rows";
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
  onOpenFile?: (path: string) => void;
  onMenu: (target: FileMenuTarget) => void;
  /** Held by the column, like the menu; see `Naming`. */
  naming: Naming | null;
  onNameDone: (name: string) => Promise<void>;
  onNameCancel: () => void;
  onClose: () => void;
}

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
  onOpenFile,
  onMenu,
  naming,
  onNameDone,
  onNameCancel,
  onClose,
}: RepoPaneProps) {
  const { t } = useTranslation();
  const { rows, listing, failed, truncated } = useRepositoryList(path, onListed);
  const [selected, setSelected] = useState<string | null>(null);
  const name = baseName(path);
  // A root that is a repository lists itself and nothing else: the row says all the header would,
  // so it stands alone and takes the header's close.
  const alone = rows.length === 1 && rows[0].path === path;

  function open(entry: FsEntry) {
    setSelected(entry.path);
  }

  return (
    <Box component="section" sx={{ pb: 0.5 }}>
      {!alone && (
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
            <PaneRepoMark />
            <Typography variant="body2" noWrap title={displayPath(path)}>
              {name}
            </Typography>
          </Box>
          <MarkButton label={t("folder.close")} onClick={onClose}>
            <CloseMark />
          </MarkButton>
        </Stack>
      )}

      {/* Never a blank: the rows found so far are drawn under the bar while the walk goes on. */}
      {listing ? (
        <LinearProgress aria-label={t("repository.listing")} sx={{ mx: 1, my: 0.5, height: 2 }} />
      ) : failed ? (
        <Box sx={{ mx: 1, my: 0.5, height: 2, borderRadius: 1, bgcolor: "error.main" }} />
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
                  data-repo-row={`${id}:${repository.path}`}
                  {...{ [DROP_INTO]: reading }}
                  sx={{ pl: alone ? 1 : ROW_INDENT, pr: 0.5, gap: 0.5, ...mark }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onMenu({
                      path: reading,
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
                    <GitMark on={opened} />
                  </ListItemIcon>
                  {/* The name alone: where under the root it is, the pointer tells. */}
                  <ListItemText
                    primary={repository.name}
                    secondary={
                      <BranchCaption
                        path={reading}
                        known={branches.get(reading)}
                        swapped={swapped}
                      />
                    }
                    sx={{ my: 0, minWidth: 0 }}
                    slotProps={{
                      primary: {
                        variant: "body2",
                        noWrap: true,
                        title: displayPath(repository.path),
                      },
                      secondary: { component: "div" },
                    }}
                  />
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
                      <MarkButton
                        label={t("folder.close")}
                        onClick={(event) => {
                          event.stopPropagation();
                          onClose();
                        }}
                      >
                        <CloseMark />
                      </MarkButton>
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
                    onOpen={open}
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
 * The branch checked out at `path`, small under the row's name. The window knows it for a
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

  const branch =
    known ?? (read?.path === path ? read.branch : undefined) ?? (swapped ? baseName(path) : null);
  if (!branch) return null;
  return (
    <Typography
      variant="caption"
      noWrap
      title={swapped ? t("repository.showing", { branch }) : branch}
      sx={{ display: "block", color: "text.secondary", fontSize: "0.68rem", lineHeight: 1.2 }}
    >
      {branch}
    </Typography>
  );
}

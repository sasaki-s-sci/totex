import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import { Box, Button, Chip, IconButton, Tooltip } from "@mui/material";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { CanvasProps } from "../canvas/CanvasProps";
import { useGraphActions } from "../canvas/graphActions";
import { displayPath } from "../folder/format";
import { useAppSettings } from "../lib/appSettings";
import type { AppNode } from "../lib/graph";
import { PageHeader } from "../page/Page";
import { PageSlot, usePageWorkspace } from "../page/PageWorkspace";
import { filePageId, terminalPageId } from "../page/placement";
import { cardGroups, type FolderCard } from "./groups";
import { PageBoard } from "./PageBoard";
import { ResizablePage } from "./ResizablePage";
import { useCardOffers } from "./useCardOffers";

export function CardBoard({
  workspace,
  folders,
  sessions,
  showing,
  nodes,
}: Pick<CanvasProps, "workspace" | "folders" | "sessions" | "showing"> & {
  nodes: readonly AppNode[];
}) {
  const { t } = useTranslation();
  const pages = usePageWorkspace();
  const actions = useGraphActions();
  const host = useRef<HTMLDivElement>(null);
  const { cardText } = useAppSettings();
  const groups = useMemo(
    () => cardGroups(workspace.repositories, folders, sessions),
    [workspace.repositories, folders, sessions],
  );
  const offered = useCardOffers(groups, actions.openWork);
  useEffect(() => {
    const card = Array.from(
      host.current?.querySelectorAll<HTMLElement>("[data-card-folder]") ?? [],
    ).find((element) => element.dataset.cardFolder === offered);
    card?.scrollIntoView({ block: "nearest" });
  }, [offered]);
  useEffect(() => {
    const page = Array.from(
      host.current?.querySelectorAll<HTMLElement>("[data-page-card]") ?? [],
    ).find((element) => element.dataset.pageCard === terminalPageId(showing ?? ""));
    page?.scrollIntoView({ block: "nearest" });
  }, [showing]);
  return (
    <Box
      ref={host}
      className="card-board"
      sx={{
        position: "absolute",
        inset: "30px 0 0",
        overflow: "auto",
        p: 2,
        "--card-text-scale": cardText / 100,
        "& [data-card-folder] .monitor-badge__row > svg": {
          width: "calc(14px * var(--card-text-scale))",
          height: "calc(14px * var(--card-text-scale))",
        },
      }}
    >
      <PageBoard
        cards={[
          ...nodes.map((node) => {
            const id = filePageId(node.data.requestId);
            return {
              id,
              visible: pages?.placement(id) !== "sidebar",
              content: (
                <ResizablePage
                  id={id}
                  initialHeight={node.height ?? 460}
                  minHeight={node.data.view === "settings" ? 220 : 96}
                >
                  <PageSlot id={id} place="cards" />
                </ResizablePage>
              ),
            };
          }),
          ...groups.flatMap(({ repository, cards }) =>
            cards.length
              ? cards.map((card) => ({
                  id: `folder:${card.path}`,
                  content: <WorkspaceCard card={card} offered={offered === card.path} />,
                }))
              : repository
                ? [
                    {
                      id: `repository:${repository.id}`,
                      content: (
                        <PageHeader
                          name={repository.name}
                          title={displayPath(repository.path)}
                          draggable
                          tabIndex={0}
                          status={
                            <Chip label="Git" size="small" color="primary" variant="outlined" />
                          }
                        >
                          <Button
                            size="small"
                            startIcon={<AddIcon />}
                            onClick={() => actions.newWork(repository)}
                          >
                            {t("cards.newWorktree")}
                          </Button>
                          <IconButton
                            size="small"
                            aria-label={t("repository.remove")}
                            onClick={() => actions.closeRepository(repository)}
                          >
                            <CloseIcon fontSize="small" />
                          </IconButton>
                        </PageHeader>
                      ),
                    },
                  ]
                : [],
          ),
        ]}
      />
    </Box>
  );
}

function WorkspaceCard({ card, offered }: { card: FolderCard; offered: boolean }) {
  const pages = usePageWorkspace();
  const { t } = useTranslation();
  const actions = useGraphActions();
  const { repository, worktree, path, name, sessions } = card;
  const branch = worktree?.branch ?? worktree?.shortHead ?? name;
  const request = { repository, cwd: path, branch };
  return (
    <Box
      component="article"
      className="folder-card"
      aria-label={displayPath(path)}
      data-card-folder={path}
      data-card-offered={offered || undefined}
      sx={{
        minWidth: 0,
        border: 1,
        borderColor: offered ? "primary.main" : "divider",
        boxShadow: offered ? "0 0 0 1px var(--mui-palette-primary-main)" : "none",
        borderRadius: 1.5,
        bgcolor: "background.paper",
      }}
    >
      <PageHeader
        name={name}
        title={displayPath(path)}
        draggable
        tabIndex={0}
        aria-description={t("page.reorder", { name })}
        onPointerDown={(event) => {
          event.currentTarget.draggable = !(
            event.target instanceof Element && event.target.closest("button, input, select, a")
          );
        }}
        status={
          worktree &&
          branch !== name && (
            <Chip
              size="small"
              variant="outlined"
              label={worktree.detached ? `${branch} · ${t("cards.detached")}` : branch}
              sx={{ maxWidth: "50%", height: "auto", fontSize: "inherit" }}
            />
          )
        }
      >
        {repository && (
          <>
            <Tooltip title={t("cards.newWorktree")}>
              <IconButton
                size="small"
                aria-label={t("cards.newWorktree")}
                onClick={() => actions.newWork(repository)}
              >
                <AddIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={t("cards.browse")}>
              <IconButton
                size="small"
                aria-label={t("cards.browse")}
                onClick={() => actions.browseWorktree({ ...request, repository })}
              >
                <FolderOpenIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title={t("cards.worktreeMenu")}>
              <IconButton
                size="small"
                aria-label={t("cards.worktreeMenu")}
                onClick={(event) =>
                  actions.pickBranch({
                    ...request,
                    repository,
                    kind: "local",
                    at: { x: event.clientX, y: event.clientY },
                  })
                }
              >
                <MoreHorizIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        )}
        <Tooltip
          title={sessions.length ? t("folder.shell") : `${t("folder.shell")} · Ctrl+Shift+Enter`}
        >
          <IconButton
            size="small"
            aria-label={t("folder.shell")}
            color={offered ? "primary" : "default"}
            onClick={() => actions.openWork(request)}
          >
            <AddIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title={t(repository ? "repository.remove" : "folder.remove")}>
          <IconButton
            size="small"
            aria-label={t(repository ? "repository.remove" : "folder.remove")}
            onClick={() =>
              repository ? actions.closeRepository(repository) : actions.closeFolder(path)
            }
          >
            <CloseIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </PageHeader>
      <PageBoard
        storageKey={`cards.layout.${path}`}
        cards={sessions.map((session) => {
          const id = terminalPageId(session.id);
          return {
            id,
            content: (
              <ResizablePage
                id={id}
                initialHeight={340}
                minHeight={180}
                compact={!pages?.expanded.includes(id)}
                onExpand={() => pages?.toggleExpanded(id)}
                onCompact={() => pages?.toggleExpanded(id)}
              >
                <PageSlot id={id} place="cards" />
              </ResizablePage>
            ),
          };
        })}
      />
    </Box>
  );
}

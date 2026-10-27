import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import MoreHorizIcon from "@mui/icons-material/MoreHoriz";
import OpenInNewIcon from "@mui/icons-material/OpenInNew";
import ViewSidebarOutlinedIcon from "@mui/icons-material/ViewSidebarOutlined";
import { Box, Button, Chip, IconButton, Stack, Tooltip, Typography } from "@mui/material";
import { useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { CanvasProps } from "../canvas/CanvasProps";
import { useGraphActions } from "../canvas/graphActions";
import { displayPath } from "../folder/format";
import { useAppSettings } from "../lib/appSettings";
import type { AppNode } from "../lib/graph";
import { MonitorAgents, MonitorBadge } from "../monitor/MonitorBadge";
import { PageSlot, usePageWorkspace } from "../page/PageWorkspace";
import { filePageId, terminalPageId } from "../page/placement";
import { cardGroups, type FolderCard } from "./groups";
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
  const actions = useGraphActions();
  const pages = usePageWorkspace();
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
    const element = Array.from(
      host.current?.querySelectorAll<HTMLElement>("[data-card-session]") ?? [],
    ).find((element) => element.dataset.cardSession === showing);
    element?.scrollIntoView({ block: "nearest" });
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
        "& [data-card-folder] .monitor-badge__count": { display: "none" },
        "& .card-workers .monitor-badge__count": {
          display: "inline-flex",
          fontSize: "calc(10px * var(--card-text-scale))",
        },
      }}
    >
      <Stack spacing={2}>
        {nodes
          .filter((node) => node.type === "file-preview")
          .map((node) => {
            const id = filePageId(node.data.requestId);
            if (pages?.placement(id) === "sidebar") return null;
            return (
              <Box
                key={id}
                sx={{ height: node.data.collapsed ? 28 : (node.height ?? 460), minWidth: 0 }}
              >
                <PageSlot id={id} place="cards" />
              </Box>
            );
          })}
        {groups.length === 0 && <Typography color="text.secondary">{t("cards.empty")}</Typography>}
        {groups.map(({ repository, cards }) => (
          <Box
            key={repository?.id ?? "folders"}
            component="section"
            aria-label={repository?.name ?? t("cards.folders")}
            sx={{
              minWidth: 0,
            }}
          >
            {repository && (
              <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
                <Chip label="Git" size="small" color="primary" variant="outlined" />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Tooltip title={displayPath(repository.path)}>
                    <Typography
                      component="h2"
                      variant="subtitle2"
                      noWrap
                      sx={{ userSelect: "text", fontSize: "calc(14px * var(--card-text-scale))" }}
                    >
                      {repository.name}
                    </Typography>
                  </Tooltip>
                </Box>
                <Button
                  size="small"
                  startIcon={<AddIcon />}
                  onClick={() => actions.newWork(repository)}
                >
                  {t("cards.newWorktree")}
                </Button>
              </Stack>
            )}
            <Box
              sx={{
                display: "flex",
                flexDirection: "column",
                gap: 1.5,
              }}
            >
              {cards.map((card) => (
                <WorkspaceCard
                  key={card.path}
                  card={card}
                  showing={showing}
                  offered={offered === card.path}
                />
              ))}
            </Box>
          </Box>
        ))}
      </Stack>
    </Box>
  );
}

function WorkspaceCard({
  card,
  showing,
  offered,
}: {
  card: FolderCard;
  showing: string | null;
  offered: boolean;
}) {
  const { t } = useTranslation();
  const actions = useGraphActions();
  const pages = usePageWorkspace();
  const { repository, worktree, path, name, sessions } = card;
  const branch = worktree?.branch ?? worktree?.shortHead ?? name;
  const request = { repository, cwd: path, branch };
  return (
    <Box
      component="article"
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
        overflow: "hidden",
      }}
    >
      <Stack
        direction="row"
        spacing={1}
        sx={{
          alignItems: "center",
          minHeight: "max(28px, calc(24px * var(--card-text-scale)))",
          px: 1,
          "& .MuiIconButton-root": { width: 24, height: 24, p: 0.25 },
          "& .MuiSvgIcon-root": { fontSize: 16 },
        }}
      >
        <Box sx={{ minWidth: 0, flex: 1, display: "flex", alignItems: "center", gap: 1 }}>
          <Tooltip title={displayPath(path)}>
            <Typography
              component="h3"
              variant="subtitle2"
              noWrap
              sx={{ userSelect: "text", fontSize: "calc(14px * var(--card-text-scale))" }}
            >
              {name}
            </Typography>
          </Tooltip>
          {worktree && branch !== name && (
            <Chip
              size="small"
              variant="outlined"
              label={worktree.detached ? `${branch} · ${t("cards.detached")}` : branch}
              sx={{
                maxWidth: "50%",
                height: "auto",
                fontSize: "calc(12px * var(--card-text-scale))",
              }}
            />
          )}
        </Box>
        {repository && (
          <>
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
        <Box
          className="card-workers"
          sx={{ display: "flex", justifyContent: "flex-end", gap: 1, flexWrap: "wrap" }}
        >
          {sessions.map((session) => (
            <MonitorAgents key={session.id} id={session.id} />
          ))}
        </Box>
      </Stack>
      <Box>
        {sessions.map((session, index) => {
          const id = terminalPageId(session.id);
          const inline = pages?.placement(id) === "canvas";
          return (
            <Box
              key={session.id}
              data-card-session={session.id}
              sx={{
                minWidth: 0,
                borderTop: 1,
                borderColor: "divider",
                boxShadow:
                  showing === session.id ? "inset 2px 0 var(--mui-palette-primary-main)" : "none",
                overflow: "hidden",
              }}
            >
              <Stack
                direction="row"
                spacing={0.5}
                sx={{
                  alignItems: "center",
                  minHeight: inline ? 28 : "calc(36px * var(--card-text-scale) + 16px)",
                  px: 0.5,
                }}
              >
                <Button
                  size="small"
                  aria-label={`${t("cli.shell")} ${index + 1}`}
                  title={`${session.branch}\n${displayPath(session.cwd)}`}
                  aria-pressed={showing === session.id}
                  onClick={() => actions.showSession(session)}
                  sx={{
                    flex: inline ? 1 : "0 1 auto",
                    justifyContent: "flex-start",
                    textTransform: "none",
                    minWidth: 0,
                    height: 28,
                    px: 0.75,
                    color: "text.secondary",
                    fontSize: "calc(11px * var(--card-text-scale))",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {index + 1}
                </Button>
                {!inline && (
                  <Box
                    className="card-session-preview"
                    sx={{
                      height: "calc(36px * var(--card-text-scale))",
                      flex: 1,
                      minWidth: 0,
                      px: 1,

                      "& .monitor-badge": {
                        display: "flex",
                        width: "100%",
                        maxWidth: "none",
                        height: "100%",
                        border: 0,
                        borderRadius: 0,
                        p: 0,
                        fontSize: "calc(11px * var(--card-text-scale))",
                        lineHeight: "calc(18px * var(--card-text-scale))",
                        justifyContent: "flex-start",
                      },
                      "& .monitor-badge__row": {
                        height: "calc(18px * var(--card-text-scale))",
                        gap: 0.5,
                      },
                    }}
                  >
                    <MonitorBadge id={session.id} />
                  </Box>
                )}
                <Tooltip title={t(inline ? "page.toSidebar" : "cards.inline", { name })}>
                  <IconButton
                    size="small"
                    aria-label={t(inline ? "page.toSidebar" : "cards.inline", { name })}
                    onClick={() => pages?.move(id, inline ? "sidebar" : "canvas")}
                  >
                    {inline ? (
                      <ViewSidebarOutlinedIcon sx={{ fontSize: 15 }} />
                    ) : (
                      <OpenInNewIcon sx={{ fontSize: 15 }} />
                    )}
                  </IconButton>
                </Tooltip>
                <Tooltip title={t("cli.end")}>
                  <IconButton
                    size="small"
                    aria-label={t("cli.end")}
                    onClick={() => actions.endSession(session)}
                  >
                    <CloseIcon sx={{ fontSize: 15 }} />
                  </IconButton>
                </Tooltip>
              </Stack>
              {inline && (
                <Box sx={{ height: 340, minHeight: 180, resize: "vertical", overflow: "hidden" }}>
                  <PageSlot id={id} place="cards" />
                </Box>
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}

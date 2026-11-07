import { Box, Button, Chip, IconButton, Tooltip } from "@mui/material";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { CanvasProps } from "../canvas/CanvasProps";
import { useGraphActions } from "../canvas/graphActions";
import { displayPath } from "../folder/format";
import { useAppSettings } from "../lib/appSettings";
import type { AppNode } from "../lib/graph";
import { worktreeBranch } from "../lib/worktrees";
import { AddMark, CloseMark, PaneFolderMark, WorkspaceMark } from "../marks";
import { PageHeader } from "../page/Page";
import { PageSlot, usePageWorkspace } from "../page/PageWorkspace";
import { filePageId, terminalPageId } from "../page/placement";
import { useFrontState } from "../shell/state";
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
  const reorderPages = pages?.reorder;
  const activePlace = pages?.activePlace;
  const renumber = useCallback(() => {
    const cards = host.current?.querySelectorAll<HTMLElement>(
      '[data-page-card^="terminal:"], [data-page-card^="file:"]',
    );
    if (cards) reorderPages?.(Array.from(cards, (card) => card.dataset.pageCard ?? ""));
  }, [reorderPages]);
  const { cardText } = useAppSettings();
  const [closed, setClosed] = useFrontState<readonly string[]>("cards.closedWorkspaces", []);
  const groups = useMemo(
    () =>
      cardGroups(workspace.repositories, folders, sessions, nodes).map((group) => ({
        ...group,
        cards: group.cards.filter(
          (card) =>
            !closed.includes(card.path) || card.sessions.length > 0 || card.files.length > 0,
        ),
      })),
    [workspace.repositories, folders, sessions, nodes, closed],
  );
  const offered = useCardOffers(groups, actions.openWork);
  useEffect(() => {
    const card = Array.from(
      host.current?.querySelectorAll<HTMLElement>("[data-card-folder]") ?? [],
    ).find((element) => element.dataset.cardFolder === offered);
    card?.scrollIntoView({ block: "nearest" });
  }, [offered]);
  useEffect(() => {
    if (activePlace === "sidebar") return;
    const page = Array.from(
      host.current?.querySelectorAll<HTMLElement>("[data-page-card]") ?? [],
    ).find((element) => element.dataset.pageCard === terminalPageId(showing ?? ""));
    const folder = page?.closest<HTMLElement>(".folder-card");
    const target =
      folder && folder.offsetHeight <= (host.current?.clientHeight ?? 0) ? folder : page;
    target?.scrollIntoView({ block: "nearest" });
  }, [showing, activePlace]);
  return (
    <Box
      ref={host}
      className="card-board"
      sx={{
        position: "absolute",
        inset: "30px 0 0",
        overflow: "auto",
        scrollbarGutter: "stable",
        p: 2,
        "&::after": {
          content: '""',
          display: "block",
          height: "50%",
          pointerEvents: "none",
        },
        "--card-text-scale": cardText / 100,
        "& [data-card-folder] .monitor-badge__row > svg": {
          width: "calc(14px * var(--card-text-scale))",
          height: "calc(14px * var(--card-text-scale))",
        },
      }}
    >
      <PageBoard
        onLayout={renumber}
        cards={[
          ...nodes
            .filter((node) => node.data.view === "settings")
            .map((node) => {
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
                  content: (
                    <WorkspaceCard
                      card={card}
                      offered={offered === card.path}
                      onLayout={renumber}
                      onClose={() => {
                        if (!card.repository) return actions.closeFolder(card.path);
                        void actions.closeWorkspace(card.path).then((closed) => {
                          if (closed) setClosed((held) => [...new Set([...held, card.path])]);
                        });
                      }}
                    />
                  ),
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
                            startIcon={<WorkspaceMark />}
                            onClick={() => actions.newWork(repository)}
                          >
                            {t("cards.newWorktree")}
                          </Button>
                          <IconButton
                            size="small"
                            aria-label={t("repository.remove")}
                            onClick={() => actions.closeRepository(repository)}
                          >
                            <CloseMark />
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

function WorkspaceCard({
  card,
  offered,
  onLayout,
  onClose,
}: {
  card: FolderCard;
  offered: boolean;
  onLayout: () => void;
  onClose: () => void;
}) {
  const pages = usePageWorkspace();
  const { t } = useTranslation();
  const actions = useGraphActions();
  const { repository, worktree, path, name, sessions, files } = card;
  const branch = worktree ? worktreeBranch(worktree) : name;
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
            event.target instanceof Element &&
            event.target.closest("button, input, select, a, .page__name")
          );
        }}
        onContextMenu={
          repository
            ? (event) => {
                event.preventDefault();
                actions.pickBranch({
                  ...request,
                  repository,
                  kind: "local",
                  at: { x: event.clientX, y: event.clientY },
                });
              }
            : undefined
        }
        status={
          worktree &&
          branch !== name && (
            <span style={{ fontSize: "0.85em", fontWeight: 300, whiteSpace: "nowrap" }}>
              {worktree.detached ? `${branch} · ${t("cards.detached")}` : branch}
            </span>
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
                <WorkspaceMark />
              </IconButton>
            </Tooltip>
            <Tooltip title={t("cards.browse")}>
              <IconButton
                size="small"
                aria-label={t("cards.browse")}
                onClick={() => actions.browseWorktree({ ...request, repository })}
              >
                <PaneFolderMark size={15} />
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
            <AddMark />
          </IconButton>
        </Tooltip>
        <Tooltip title={t(repository ? "cards.closeWorkspace" : "folder.remove")}>
          <IconButton
            size="small"
            aria-label={t(repository ? "cards.closeWorkspace" : "folder.remove")}
            onClick={onClose}
          >
            <CloseMark />
          </IconButton>
        </Tooltip>
      </PageHeader>
      <PageBoard
        storageKey={`cards.layout.${path}`}
        onLayout={onLayout}
        cards={[
          ...sessions.map((session) => {
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
          }),
          ...files.map((node) => {
            const id = filePageId(node.data.requestId);
            return {
              id,
              visible: pages?.placement(id) !== "sidebar",
              content: (
                <ResizablePage id={id} initialHeight={node.height ?? 460} minHeight={96}>
                  <PageSlot id={id} place="cards" />
                </ResizablePage>
              ),
            };
          }),
        ]}
      />
    </Box>
  );
}

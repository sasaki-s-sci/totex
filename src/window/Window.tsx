import { Alert, Box, Snackbar } from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAsks } from "../hooks/useAsks";
import { useAutoFollow } from "../hooks/useAutoFollow";
import { useCanvasWork } from "../hooks/useCanvasWork";
import { useDoings } from "../hooks/useDoings";
import { useDrops } from "../hooks/useDrops";
import { useFileDrops } from "../hooks/useFileDrops";
import { useMarks } from "../hooks/useMarks";
import { useOverseer } from "../hooks/useOverseer";
import { useReports } from "../hooks/useReports";
import { useServing } from "../hooks/useServing";
import { useSessionKeys } from "../hooks/useSessionKeys";
import { useSessions } from "../hooks/useSessions";
import { useSpares } from "../hooks/useSpares";
import { useTaskKeys } from "../hooks/useTaskKeys";
import { useWorkspaces } from "../hooks/useWorkspace";
import type { Ask } from "../lib/ask";
import { FILE_DRAG_TYPE } from "../lib/filePreview";
import type { Graphed } from "../lib/graphed";
import { useEver } from "../lib/onDemand";
import { mergedReports } from "../lib/overseen";
import { sessionsInPlaces } from "../lib/placeSessions";
import { worktreeBranches, worktreeHomes } from "../lib/worktrees";
import { Frame, MarkButton } from "../marks";
import { PageWorkspace } from "../page/PageWorkspace";
import {
  canvasPart,
  commitPart,
  EMPTY_WORKSPACE,
  sidebarPart,
  tasksPart,
  worktreePart,
} from "../parts";
import { useFrontState } from "../shell/state";
import {
  type FolderDestination,
  type FolderUngraph,
  LeftSidebar,
  type Pane,
} from "../sidebar/LeftSidebar";
import type { Repository } from "../types/git";
import { SshPassword } from "./SshPassword";
import { useFolderRoots } from "./useFolderRoots";
import { useWindowBoot } from "./useWindowBoot";
import { useWindowMenus } from "./useWindowMenus";
import { WindowBand } from "./WindowBand";
import { HEADER_INSET, WindowControls } from "./WindowControls";

/** LeftSidebar | Canvas | RightSidebar, and the menus drawn over them. */
// One map for every render: a fresh empty one would redraw the canvas each time.
const NO_ASKS: ReadonlyMap<string, Ask> = new Map();

export function Window() {
  const { t } = useTranslation();
  const [leftOpen, setLeftOpen] = useFrontState("window.foldersOpen", false);
  const [destination, setDestination] = useState<FolderDestination | null>(null);
  const [ungraph, setUngraph] = useState<FolderUngraph | null>(null);
  const [removeFailed, setRemoveFailed] = useState(false);
  const folders = useFolderRoots();
  const menus = useWindowMenus();
  useServing();
  const canvasHost = useRef<HTMLElement>(null);
  const { marks, fail, hold, release } = useMarks();

  const sessions = useSessions();
  const asks = useAsks();
  const said = useReports();
  const overseer = useOverseer();
  // While the overseer runs, everything beside a terminal is its line: the agents' own reports and
  // questions reach the person through it.
  const overseen = overseer.session !== null;
  const reports = useMemo(
    () => mergedReports(said, overseer.statuses, overseen),
    [said, overseer.statuses, overseen],
  );
  // The host opens the overseer's shell itself, maybe after this window listed what was running.
  const { pickUp } = sessions;
  const overseerKnown = sessions.sessions.some(({ id }) => id === overseer.session);
  useEffect(() => {
    if (overseen && !overseerKnown) pickUp();
  }, [overseen, overseerKnown, pickUp]);
  const doings = useDoings();
  useSessionKeys({ sessions: sessions.sessions, showing: sessions.showing, open: sessions.open });
  const tasks = useTaskKeys({
    sessions: sessions.sessions,
    showing: sessions.showing,
    open: sessions.open,
  });

  const { workspace, folders: graphed } = useWorkspaces(folders.roots);
  const homes = useMemo(() => worktreeHomes(workspace), [workspace]);
  const branches = useMemo(() => worktreeBranches(workspace), [workspace]);
  useAutoFollow(workspace?.repositories ?? EMPTY_WORKSPACE.repositories);
  useSpares(workspace?.repositories ?? EMPTY_WORKSPACE.repositories);
  const files = useFileDrops();
  const drops = useDrops(canvasHost, files.openFiles);
  const deletePlace = useCallback(
    async (place: Graphed) => {
      await sessions.endMatching(sessionsInPlaces([place], workspace?.repositories ?? []));
      setUngraph({ root: place.root, kind: place.kind });
    },
    [sessions.endMatching, workspace],
  );
  const deletePane = useCallback(
    async (pane: Pane) => {
      const owned: Graphed[] = [
        { kind: pane.kind, root: pane.path },
        ...pane.graphed.map((root) => ({ kind: pane.kind, root })),
      ];
      await sessions.endMatching(sessionsInPlaces(owned, workspace?.repositories ?? []));
    },
    [sessions.endMatching, workspace],
  );
  const closeRepository = useCallback(
    (repository: Repository) => {
      const root =
        graphed.find((folder) => folder.repositories.includes(repository.id))?.root ??
        repository.path;
      void deletePlace({ kind: "repository", root }).catch(() => setRemoveFailed(true));
    },
    [deletePlace, graphed],
  );
  const closeFolder = useCallback(
    (root: string) => {
      void deletePlace({ kind: "folder", root }).catch(() => setRemoveFailed(true));
    },
    [deletePlace],
  );
  useWindowBoot(workspace);

  const browseFolder = useCallback(
    (repository: Repository, path: string) => {
      const root = graphed.find((folder) => folder.repositories.includes(repository.id))?.root;
      if (!root) return;
      setLeftOpen(true);
      setDestination({ root, path });
    },
    [graphed],
  );
  const work = useCanvasWork({
    openSession: sessions.open,
    fail,
    hold,
    release,
    setCommitMenu: menus.setCommit,
    onBrowseFolder: browseFolder,
  });

  const Canvas = canvasPart.use();
  const RightSidebar = sidebarPart.use();
  const CommitMenu = commitPart.use(useEver(menus.commit !== null));
  const WorktreeMenu = worktreePart.use(useEver(menus.worktree !== null));
  const TaskMenu = tasksPart.use(useEver(tasks.asking !== null));

  return (
    <PageWorkspace sessions={sessions}>
      <Box
        sx={{
          position: "relative",
          display: "flex",
          height: "100vh",
          // No ground: the body paints it, so the wave can sit between the two.
        }}
      >
        {!leftOpen && (
          <Box sx={{ position: "absolute", top: HEADER_INSET, left: HEADER_INSET, zIndex: 1200 }}>
            <MarkButton
              label={t("folder.expandSidebar")}
              aria-expanded={leftOpen}
              aria-controls="folder-sidebar"
              onClick={() => setLeftOpen(true)}
            >
              <Frame>
                <path d="M9 6 15 12 9 18" />
              </Frame>
            </MarkButton>
          </Box>
        )}
        <LeftSidebar
          open={leftOpen}
          onClose={() => setLeftOpen(false)}
          initialPanes={folders.initial}
          onGraphedChange={folders.setRoots}
          onPanesChange={folders.keep}
          onBrowsingChange={folders.browse}
          onOpenSettings={menus.openSettings}
          onOpenFile={(path) => files.openFiles([path], null)}
          drops={drops}
          destination={destination}
          ungraph={ungraph}
          homes={homes}
          branches={branches}
          onDeletePane={deletePane}
        />

        <Box
          ref={canvasHost}
          component="main"
          onDragOver={(event) => {
            if (!event.dataTransfer.types.includes(FILE_DRAG_TYPE)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(event) => {
            const path = event.dataTransfer.getData(FILE_DRAG_TYPE);
            if (!path) return;
            event.preventDefault();
            files.openFiles([path], { x: event.clientX, y: event.clientY });
          }}
          sx={{ position: "relative", flex: 1, minWidth: 0 }}
        >
          <WindowBand />
          {Canvas && (
            <Canvas
              workspace={workspace ?? EMPTY_WORKSPACE}
              folders={graphed}
              browsing={folders.browsing}
              sessions={sessions.sessions}
              showing={sessions.showing}
              paged={sessions.paged}
              asks={overseen ? NO_ASKS : asks.asks}
              reports={reports}
              overseen={overseen}
              doings={doings}
              onAnswer={asks.answer}
              onReply={asks.reply}
              onPoint={asks.point}
              onPick={asks.pick}
              onTake={asks.take}
              marks={marks}
              onSelect={work.pickCommit}
              onNewWork={work.newWork}
              onOpenWork={work.openWork}
              onBrowseWorktree={work.browseWorktree}
              onPickBranch={menus.setWorktree}
              onCloseRepository={closeRepository}
              onCloseFolder={closeFolder}
              onMerge={work.merge}
              onSync={work.sync}
              onFetch={work.fetch}
              onShowSession={sessions.show}
              onJumpSession={sessions.jump}
              onEndSession={sessions.end}
              filePreviews={files.filePreviews}
              onPreviewFile={files.previewFile}
              onCloseFilePreview={files.closeFilePreview}
              onOpenPinned={files.openPinned}
              settingsRequest={menus.settingsRequest}
              onCloseSettings={menus.closeSettings}
            />
          )}
        </Box>

        {RightSidebar && <RightSidebar />}

        <WindowControls />
        <SshPassword />
        <Snackbar open={removeFailed} onClose={() => setRemoveFailed(false)}>
          <Alert severity="error" onClose={() => setRemoveFailed(false)}>
            {t("folder.removeFailed")}
          </Alert>
        </Snackbar>

        {TaskMenu && <TaskMenu session={tasks.asking} onClose={tasks.close} onRun={tasks.run} />}
        {CommitMenu && (
          <CommitMenu target={menus.commit} onClose={menus.closeCommit} onOpen={sessions.open} />
        )}
        {WorktreeMenu && (
          <WorktreeMenu
            target={menus.worktree}
            onClose={menus.closeWorktree}
            onOpen={sessions.open}
            onEndAttached={sessions.endIn}
          />
        )}
      </Box>
    </PageWorkspace>
  );
}

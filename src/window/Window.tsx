import { Box } from "@mui/material";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAskActions } from "../hooks/useAskActions";
import { useAsks } from "../hooks/useAsks";
import { useAutoFollow } from "../hooks/useAutoFollow";
import { useCanvasWork } from "../hooks/useCanvasWork";
import { useDoings } from "../hooks/useDoings";
import { useDrops } from "../hooks/useDrops";
import { useFileDrops } from "../hooks/useFileDrops";
import { useMarks } from "../hooks/useMarks";
import { useReports } from "../hooks/useReports";
import { useServing } from "../hooks/useServing";
import { useSessionKeys } from "../hooks/useSessionKeys";
import { useSessions } from "../hooks/useSessions";
import { useTaskKeys } from "../hooks/useTaskKeys";
import { useWorkspaces } from "../hooks/useWorkspace";
import { FILE_DRAG_TYPE } from "../lib/filePreview";
import { type CliPlace, sameCliRun } from "../lib/graphNav";
import { useEver } from "../lib/onDemand";
import { worktreeHomes } from "../lib/worktrees";
import { Frame, MarkButton } from "../marks";
import {
  canvasPart,
  commitPart,
  EMPTY_WORKSPACE,
  sidebarPart,
  tasksPart,
  worktreePart,
} from "../parts";
import { useFrontState } from "../shell/state";
import { type FolderDestination, LeftSidebar } from "../sidebar/LeftSidebar";
import { type Tab, terminalTabs } from "../tab/tab";
import type { Repository } from "../types/git";
import { useClosedRepositories } from "./useClosedRepositories";
import { useFolderRoots } from "./useFolderRoots";
import { useWindowBoot } from "./useWindowBoot";
import { useWindowMenus } from "./useWindowMenus";
import { WindowBand } from "./WindowBand";
import { HEADER_INSET, WindowControls } from "./WindowControls";

/** LeftSidebar | Canvas | RightSidebar, and the menus drawn over them. */
export function Window() {
  const { t } = useTranslation();
  const [leftOpen, setLeftOpen] = useFrontState("window.foldersOpen", false);
  const [destination, setDestination] = useState<FolderDestination | null>(null);
  const folders = useFolderRoots();
  const menus = useWindowMenus();
  const mcp = useServing();
  const canvasHost = useRef<HTMLElement>(null);
  const { marks, fail, hold, release } = useMarks();

  const sessions = useSessions();
  const [run, setRun] = useState<readonly CliPlace[]>([]);
  const takeRun = useCallback((next: readonly CliPlace[]) => {
    setRun((held) => (sameCliRun(held, next) ? held : next));
  }, []);
  const asks = useAsks();
  const reports = useReports();
  const doings = useDoings();
  useSessionKeys({ sessions: sessions.sessions, showing: sessions.showing, open: sessions.open });
  const tasks = useTaskKeys({
    sessions: sessions.sessions,
    showing: sessions.showing,
    open: sessions.open,
  });

  const { workspace, folders: graphed } = useWorkspaces(folders.roots);
  const homes = useMemo(() => worktreeHomes(workspace), [workspace]);
  useAutoFollow(workspace?.repositories ?? EMPTY_WORKSPACE.repositories);
  const files = useFileDrops();
  const drops = useDrops(canvasHost, files.openFiles);
  const askActions = useAskActions(asks);
  const { drawn, closeRepository } = useClosedRepositories(workspace);
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

  const tabs = useMemo(() => terminalTabs(sessions.sessions), [sessions.sessions]);
  const onTab = (act: (session: (typeof sessions.sessions)[number]) => void) => (tab: Tab) => {
    if (tab.kind === "terminal") act(tab.session);
  };

  const Canvas = canvasPart.use();
  const RightSidebar = sidebarPart.use(useEver(tabs.length > 0));
  const CommitMenu = commitPart.use(useEver(menus.commit !== null));
  const WorktreeMenu = worktreePart.use(useEver(menus.worktree !== null));
  const TaskMenu = tasksPart.use(useEver(tasks.asking !== null));

  return (
    <Box
      sx={{ position: "relative", display: "flex", height: "100vh", bgcolor: "background.default" }}
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
        initialFolders={folders.initial}
        onExpandedChange={folders.setRoots}
        onFoldersChange={folders.browse}
        onOpenSettings={menus.openSettings}
        onOpenFile={(path) => files.openFiles([path], null)}
        drops={drops}
        destination={destination}
        homes={homes}
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
            workspace={drawn ?? EMPTY_WORKSPACE}
            folders={graphed}
            browsing={folders.browsing}
            sessions={sessions.sessions}
            showing={sessions.showing}
            paged={sessions.paged}
            asks={asks.asks}
            reports={reports}
            doings={doings}
            onAnswer={askActions.answerAsk}
            onReply={askActions.replyToAsk}
            onPoint={askActions.pointAtAsk}
            onPick={askActions.pickInAsk}
            onTake={askActions.takeAsking}
            marks={marks}
            onSelect={work.pickCommit}
            onCutBranch={work.cutBranch}
            onOpenWork={work.openWork}
            onBrowseWorktree={work.browseWorktree}
            onPickBranch={menus.setWorktree}
            onCloseRepository={closeRepository}
            onMerge={work.merge}
            onSync={work.sync}
            onFetch={work.fetch}
            onShowSession={sessions.show}
            onJumpSession={sessions.jump}
            onEndSession={sessions.end}
            onDockSession={sessions.dock}
            onCliRun={takeRun}
            filePreviews={files.filePreviews}
            onPreviewFile={files.previewFile}
            onCloseFilePreview={files.closeFilePreview}
            onOpenPinned={files.openPinned}
            settingsRequest={menus.settingsRequest}
            mcp={mcp}
            onCloseSettings={menus.closeSettings}
          />
        )}
      </Box>

      {RightSidebar && (
        <RightSidebar
          tabs={tabs}
          showing={sessions.showing}
          paged={sessions.paged}
          run={run}
          doings={doings}
          onPage={onTab(sessions.page)}
          onEnded={onTab(sessions.end)}
        />
      )}

      <WindowControls />

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
  );
}

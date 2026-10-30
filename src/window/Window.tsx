import { Alert, Box, Snackbar } from "@mui/material";
import { useCallback, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAutoFollow } from "../hooks/useAutoFollow";
import { useCanvasWork } from "../hooks/useCanvasWork";
import { useDrops } from "../hooks/useDrops";
import { useFileDrops } from "../hooks/useFileDrops";
import { useServing } from "../hooks/useServing";
import { useSessionKeys } from "../hooks/useSessionKeys";
import { useSessions } from "../hooks/useSessions";
import { useSpares } from "../hooks/useSpares";
import { useWorkspaces } from "../hooks/useWorkspace";
import { hasFileDrag, readFileDrag } from "../lib/filePreview";
import type { Graphed } from "../lib/graphed";
import { useEver } from "../lib/onDemand";
import { sessionsInPlaces } from "../lib/placeSessions";
import { worktreeBranches, worktreeHomes } from "../lib/worktrees";
import { Frame, MarkButton } from "../marks";
import { useMonitorRuntime } from "../monitor/runtime";
import { PageWorkspace } from "../page/PageWorkspace";
import { canvasPart, EMPTY_WORKSPACE, sidebarPart, worktreePart } from "../parts";
import { useResumeRuntime } from "../resume/runtime";
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
export function Window() {
  const { t } = useTranslation();
  const [leftOpen, setLeftOpen] = useFrontState("window.foldersOpen", true);
  const [destination, setDestination] = useState<FolderDestination | null>(null);
  const [ungraph, setUngraph] = useState<FolderUngraph | null>(null);
  const [removeFailed, setRemoveFailed] = useState(false);
  const folders = useFolderRoots();
  const menus = useWindowMenus();
  useServing();
  useMonitorRuntime();
  const canvasHost = useRef<HTMLElement>(null);
  const [workFailed, setWorkFailed] = useState(false);
  const fail = useCallback(() => setWorkFailed(true), []);

  const sessions = useSessions();
  useResumeRuntime(sessions);
  useSessionKeys({
    sessions: sessions.sessions,
    showing: sessions.active,
    open: sessions.open,
    jump: sessions.jump,
    end: sessions.end,
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
      const kept = graphed.filter((folder) => folder.root !== place.root).map((f) => f.root);
      await sessions.endMatching(sessionsInPlaces([place], workspace?.repositories ?? [], kept));
      setUngraph({ root: place.root, kind: place.kind });
    },
    [sessions.endMatching, workspace, graphed],
  );
  const deletePane = useCallback(
    async (pane: Pane) => {
      const owned: Graphed[] = [
        { kind: pane.kind, root: pane.path },
        ...pane.graphed.map((root) => ({ kind: pane.kind, root })),
      ];
      const ownedRoots = new Set(owned.map((place) => place.root));
      const kept = graphed.filter((folder) => !ownedRoots.has(folder.root)).map((f) => f.root);
      await sessions.endMatching(sessionsInPlaces(owned, workspace?.repositories ?? [], kept));
    },
    [sessions.endMatching, workspace, graphed],
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
    onBrowseFolder: browseFolder,
  });

  const Canvas = canvasPart.use();
  const RightSidebar = sidebarPart.use();
  const WorktreeMenu = worktreePart.use(useEver(menus.worktree !== null));

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
            if (!hasFileDrag(event.dataTransfer)) return;
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDrop={(event) => {
            const paths = readFileDrag(event.dataTransfer)
              .filter((entry) => !entry.isDir)
              .map((entry) => entry.path);
            if (!paths.length) return;
            event.preventDefault();
            files.openFiles(paths, { x: event.clientX, y: event.clientY });
          }}
          sx={{ position: "relative", flex: 1, minWidth: 0 }}
        >
          <WindowBand />
          {Canvas && (
            <Canvas
              workspace={workspace ?? EMPTY_WORKSPACE}
              folders={graphed}
              sessions={sessions.sessions}
              showing={sessions.active}
              onNewWork={work.newWork}
              onOpenWork={work.openWork}
              onBrowseWorktree={work.browseWorktree}
              onPickBranch={menus.setWorktree}
              onCloseRepository={closeRepository}
              onCloseFolder={closeFolder}
              onEndSession={sessions.end}
              filePreviews={files.filePreviews}
              onPreviewFile={files.previewFile}
              onCloseFilePreview={files.closeFilePreview}
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

        <Snackbar open={workFailed} onClose={() => setWorkFailed(false)}>
          <Alert severity="error" onClose={() => setWorkFailed(false)}>
            {t("file.failed")}
          </Alert>
        </Snackbar>

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

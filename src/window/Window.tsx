import { Alert, Box, Snackbar } from "@mui/material";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { CanvasTabs } from "../canvas/CanvasTabs";
import { FileDropPreview } from "../canvas/FileDropPreview";
import { useCanvases } from "../canvas/useCanvases";
import { canvasOf, useCanvasTabs } from "../canvas/useCanvasTabs";
import { baseName, folderOf } from "../folder/format";
import { useAutoFollow } from "../hooks/useAutoFollow";
import { useCanvasWork } from "../hooks/useCanvasWork";
import { useDrops } from "../hooks/useDrops";
import { useFileDrops } from "../hooks/useFileDrops";
import { useServing } from "../hooks/useServing";
import { useSessions } from "../hooks/useSessions";
import { useSpares } from "../hooks/useSpares";
import { useWorkspaces } from "../hooks/useWorkspace";
import { pasteMedia } from "../lib/clipboard";
import type { Graphed } from "../lib/graphed";
import { typing } from "../lib/keys";
import { useEver } from "../lib/onDemand";
import { type FileRequest, OPEN_FILE } from "../lib/openFile";
import { sessionsInPlaces, underPlace } from "../lib/placeSessions";
import { shellSession } from "../lib/session";
import { worktreeBranches, worktreeHomes } from "../lib/worktrees";
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
import { SidebarReopen } from "../sidebar/SidebarReopen";
import type { Repository } from "../types/git";
import { SshPassword } from "./SshPassword";
import { useFolderRoots } from "./useFolderRoots";
import { useWindowBoot } from "./useWindowBoot";
import { useWindowMenus } from "./useWindowMenus";
import { WindowControls } from "./WindowControls";

/** LeftSidebar | Canvas | RightSidebar, and the menus drawn over them. */
export function Window() {
  const { t } = useTranslation();
  const [leftOpen, setLeftOpen] = useFrontState("window.foldersOpen", true);
  const [destination, setDestination] = useState<FolderDestination | null>(null);
  const [ungraph, setUngraph] = useState<FolderUngraph | null>(null);
  const [removeFailed, setRemoveFailed] = useState(false);
  const [pasteFailed, setPasteFailed] = useState(false);
  const folders = useFolderRoots();
  const menus = useWindowMenus();
  useServing();
  const canvasHost = useRef<HTMLElement>(null);
  const [workFailed, setWorkFailed] = useState(false);
  const fail = useCallback(() => setWorkFailed(true), []);

  const sessions = useSessions();
  const canvas = useCanvases();
  const tabs = useCanvasTabs(sessions, canvas);
  const current = tabs.current;
  const terminal =
    sessions.sessions.find((one) => one.id === sessions.selected) ??
    sessions.sessions.find((one) => canvasOf(one) === current?.id);
  useResumeRuntime(sessions);

  const { workspace, folders: graphed } = useWorkspaces(folders.roots);
  const homes = useMemo(() => worktreeHomes(workspace), [workspace]);
  const branches = useMemo(() => worktreeBranches(workspace), [workspace]);
  useAutoFollow(workspace?.repositories ?? EMPTY_WORKSPACE.repositories);
  useSpares(workspace?.repositories ?? EMPTY_WORKSPACE.repositories);
  const files = useFileDrops(current?.id, (path, folder) => {
    const cwd = folder ?? folderOf(path) ?? ".";
    const session = shellSession(cwd, baseName(cwd), true);
    return tabs.openTab(session);
  });
  const drops = useDrops(canvasHost, files.openFiles);
  useEffect(() => {
    const open = (event: Event) => {
      const request = (event as CustomEvent<FileRequest>).detail;
      if (!request || !sessions.sessions.some((session) => session.id === request.sessionId))
        return;
      event.preventDefault();
      const session = sessions.sessions.find((session) => session.id === request.sessionId);
      if (session)
        files.openFiles([request.path], null, undefined, { sessionId: canvasOf(session) });
    };
    window.addEventListener(OPEN_FILE, open);
    return () => window.removeEventListener(OPEN_FILE, open);
  }, [sessions.sessions, files.openFiles]);
  const deletePlace = useCallback(
    async (place: Graphed) => {
      const kept = graphed.filter((folder) => folder.root !== place.root).map((f) => f.root);
      await tabs.endMatching(sessionsInPlaces([place], workspace?.repositories ?? [], kept));
      setUngraph({ root: place.root, kind: place.kind });
    },
    [tabs.endMatching, workspace, graphed],
  );
  const deletePane = useCallback(
    async (pane: Pane) => {
      const owned: Graphed[] = [
        { kind: pane.kind, root: pane.path },
        ...pane.graphed.map((root) => ({ kind: pane.kind, root })),
      ];
      const ownedRoots = new Set(owned.map((place) => place.root));
      const kept = graphed.filter((folder) => !ownedRoots.has(folder.root)).map((f) => f.root);
      await tabs.endMatching(sessionsInPlaces(owned, workspace?.repositories ?? [], kept));
    },
    [tabs.endMatching, workspace, graphed],
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

  const closeWorkspace = useCallback(
    async (root: string) => {
      const kept = [
        ...graphed.map((folder) => folder.root),
        ...(workspace?.repositories ?? []).flatMap((repo) =>
          repo.worktrees.map((worktree) => worktree.path),
        ),
      ].filter((path) => !(underPlace(path, root) && underPlace(root, path)));
      try {
        await tabs.endMatching(sessionsInPlaces([{ kind: "folder", root }], [], kept));
        return true;
      } catch {
        setRemoveFailed(true);
        return false;
      }
    },
    [tabs.endMatching, workspace, graphed],
  );

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
    openSession: tabs.open,
    fail,
    onBrowseFolder: browseFolder,
  });

  const Canvas = canvasPart.use();
  const RightSidebar = sidebarPart.use();
  const WorktreeMenu = worktreePart.use(useEver(menus.worktree !== null));

  return (
    <PageWorkspace sessions={{ ...sessions, open: tabs.open }}>
      <Box
        sx={{
          position: "relative",
          display: "flex",
          height: "100vh",
          // No ground: the body paints it, so the wave can sit between the two.
        }}
      >
        {!leftOpen && <SidebarReopen side="left" onClick={() => setLeftOpen(true)} />}
        <LeftSidebar
          open={leftOpen}
          onClose={() => setLeftOpen(false)}
          initialPanes={folders.initial}
          onGraphedChange={folders.setRoots}
          onPanesChange={folders.keep}
          onBrowsingChange={folders.browse}
          onOpenSettings={menus.openSettings}
          onOpenFile={(path, folder) => files.openFiles([path], null, folder)}
          drops={drops}
          destination={destination}
          ungraph={ungraph}
          homes={homes}
          branches={branches}
          onDeletePane={deletePane}
          layout={
            current
              ? {
                  id: current.id,
                  panes: canvas.canvases[current.id]?.panes ?? [],
                  tree: canvas.layouts[current.id],
                  arrange: (tree) => canvas.arrange(current.id, tree),
                  change: (update) => canvas.change(current.id, update),
                }
              : null
          }
        />

        <Box
          ref={canvasHost}
          component="main"
          tabIndex={-1}
          onPointerDown={(event) => {
            if (!(event.target as Element).closest(".page, button, input, textarea"))
              event.currentTarget.focus();
          }}
          onPaste={(event) => {
            if (typing(event.target) || !event.clipboardData.files.length) return;
            event.preventDefault();
            event.stopPropagation();
            void pasteMedia(undefined, event.clipboardData)
              .then((paths) => files.openFiles(paths, null))
              .catch(() => setPasteFailed(true));
          }}
          onKeyDown={(event) => {
            if (
              typing(event.target) ||
              event.defaultPrevented ||
              event.altKey ||
              !(event.ctrlKey || event.metaKey) ||
              event.key.toLowerCase() !== "v"
            )
              return;
            event.preventDefault();
            if (!event.repeat)
              void pasteMedia()
                .then((paths) => files.openFiles(paths, null))
                .catch(() => setPasteFailed(true));
          }}
          sx={{
            position: "relative",
            flex: 1,
            minWidth: 0,
            display: "flex",
            flexDirection: "column",
          }}
        >
          <CanvasTabs
            tabs={tabs}
            sessions={sessions.sessions}
            activeTerminal={terminal?.id}
            workspace={workspace ?? EMPTY_WORKSPACE}
            folders={graphed}
            onNewPage={() => {
              if (!current) return;
              void canvas
                .change(current.id, (panes) => [
                  ...panes,
                  { id: crypto.randomUUID(), kind: "empty" },
                ])
                .catch(() => undefined);
            }}
            fail={fail}
          />
          <Snackbar open={pasteFailed} onClose={() => setPasteFailed(false)}>
            <Alert severity="error" onClose={() => setPasteFailed(false)}>
              {t("file.pasteFailed")}
            </Alert>
          </Snackbar>
          <FileDropPreview drop={drops.preview} />
          {Canvas && (
            <Canvas
              state={canvas}
              tabs={tabs.tabs}
              activeCanvas={current?.id ?? null}
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
              onCloseWorkspace={closeWorkspace}
              onEndSession={sessions.end}
              onNewTerminal={tabs.addTerminal}
              filePreviews={files.filePreviews}
              onPreviewFile={files.previewFile}
              onCloseFilePreview={files.closeFilePreview}
              settingsRequest={menus.settingsRequest}
              onCloseSettings={menus.closeSettings}
            />
          )}
        </Box>

        {RightSidebar && (
          <RightSidebar
            workspace={workspace ?? EMPTY_WORKSPACE}
            folders={graphed}
            sessions={sessions.sessions}
            showing={terminal?.id ?? null}
            onOpenWork={work.openWork}
            onEndSession={sessions.end}
          />
        )}

        <WindowControls />
        <SshPassword />
        <Snackbar open={sessions.closeFailed} onClose={sessions.clearCloseFailure}>
          <Alert severity="error" onClose={sessions.clearCloseFailure}>
            {t("terminal.closeFailed")}
          </Alert>
        </Snackbar>
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
            onOpen={tabs.open}
            onEndAttached={(cwd) => tabs.endMatching((session) => session.cwd === cwd)}
          />
        )}
      </Box>
    </PageWorkspace>
  );
}

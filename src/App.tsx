import { Box, CssBaseline, LinearProgress } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CommitTarget } from "./components/CommitMenu";
import type { BranchPick, MergeRequest } from "./components/GitGraph";
import type { WorkRequest } from "./components/graphActions";
import { branchMark } from "./components/graphMarks";
import { HEADER_HEIGHT, WindowControls } from "./components/WindowControls";
import type { WorktreeTarget } from "./components/WorktreeMenu";
import { FolderSidebar } from "./folder/FolderSidebar";
import { useAsks } from "./hooks/useAsks";
import { useMarks } from "./hooks/useMarks";
import { useSessions } from "./hooks/useSessions";
import { useGitMissing, useWorkspaces } from "./hooks/useWorkspace";
import type { Ask } from "./lib/ask";
import { FILE_DRAG_TYPE, type FilePreviewRequest } from "./lib/filePreview";
import type { CommitFlowNode } from "./lib/graph";
import { onDemand, warmInTurn } from "./lib/onDemand";
import { type Session, shellSession } from "./lib/session";
import { mergeBranch, openWorkspace } from "./lib/workspace";
import { MODE_KEY, storedMode, theme } from "./theme";
import type { Repository, Workspace } from "./types/git";

/**
 * The heavy halves of the window, loaded separately from the first paint.
 *
 * A window that has just opened is a column of folders: the canvas has read
 * nothing, no session is running, and no menu is open. The graph is requested
 * immediately so its canvas is always present; the terminal and dialogs stay
 * on demand. Keeping them in separate chunks leaves all of them off the way to
 * the first column.
 */
const graphPart = onDemand(() => import("./components/GitGraph").then((part) => part.GitGraph));
const panelPart = onDemand(() => import("./components/SidePanel").then((part) => part.SidePanel));
const commitPart = onDemand(() =>
  import("./components/CommitMenu").then((part) => part.CommitMenu),
);
const worktreePart = onDemand(() =>
  import("./components/WorktreeMenu").then((part) => part.WorktreeMenu),
);
const settingsPart = onDemand(() =>
  import("./components/SettingsDialog").then((part) => part.SettingsDialog),
);

const ROOTS_KEY = "totex.roots";
const EMPTY_WORKSPACE: Workspace = { root: "file-previews", repositories: [], warnings: [] };

/**
 * The folders the column was showing when the window last closed.
 *
 * Where they were browsing, and nothing about the graph: what the graph draws
 * is asked for a folder at a time, so a window that has just opened has a
 * column to pick up from and a canvas that has read nothing.
 */
function storedRoots(): string[] {
  return ["/home/a/repo/sasaki-s-sci/test-for-eni"];
}
export default function App() {
  return (
    // The mode is read again here rather than passed in: `main` has already
    // written it onto the document, and this is the provider being told the
    // same thing so that the two agree from the first render. Transitions are
    // off across the change -- every colour in the window moves at once, and a
    // window that fades between two palettes is a window that stutters.
    <ThemeProvider
      theme={theme}
      defaultMode={storedMode()}
      modeStorageKey={MODE_KEY}
      disableTransitionOnChange
    >
      <CssBaseline />
      <Window />
    </ThemeProvider>
  );
}

function Window() {
  // The folders the sidebar has been asked to put on the graph, by the mark
  // beside each of them. Empty until one is pressed: browsing the column moves
  // panes around and reads directories, and neither is a reason to scan a tree.
  const [roots, setRoots] = useState<string[]>([]);
  // Where the column starts. Read once — the sidebar owns the panes from there,
  // and reports back what to keep for next time.
  const [initialFolders] = useState(storedRoots);
  const [commitMenu, setCommitMenu] = useState<CommitTarget | null>(null);
  const [worktreeMenu, setWorktreeMenu] = useState<WorktreeTarget | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filePreviews, setFilePreviews] = useState<FilePreviewRequest[]>([]);
  const nextFilePreview = useRef(0);
  const main = useRef<HTMLElement>(null);
  // What the window is doing to a branch, and what it was refused. Both are
  // drawn on the branch's own ring — see `useMarks`; nothing is written.
  const { marks, fail, hold, release } = useMarks();

  // Everything that is running, and which one the panel is showing.
  const {
    sessions,
    showing,
    open: openSession,
    show: showSession,
    end: endSession,
    endIn: endSessionsIn,
  } = useSessions();

  // What any of them has stopped to ask, which the graph draws beside the
  // terminal doing the asking. A question is a turn nobody has taken: it is
  // worth seeing from the canvas, and worth being able to answer from there.
  const { asks, answer } = useAsks();

  const { workspace, folders, loading, failed } = useWorkspaces(roots);
  const gitMissing = useGitMissing(roots);

  const openFiles = useCallback((paths: readonly string[], at: { x: number; y: number } | null) => {
    setFilePreviews((current) => [
      ...current,
      ...paths.map((path, index) => ({
        id: nextFilePreview.current++,
        path,
        at: at ? { x: at.x + index * 18, y: at.y + index * 18 } : null,
      })),
    ]);
  }, []);

  // Held still, because the graph's actions are context: a callback rebuilt on
  // every render is every node on the canvas told that something changed.
  const answerAsk = useCallback(
    (session: Session, ask: Ask, key: string) => answer(session.id, ask, key),
    [answer],
  );

  const closeFilePreview = useCallback((requestId: number) => {
    setFilePreviews((current) => current.filter((preview) => preview.id !== requestId));
  }, []);

  // Native file drops do not become browser drop events in a Tauri webview.
  // Listen at the window boundary, then turn the physical point into the CSS
  // coordinates React Flow expects. Drops over the explorer stay the
  // explorer's; only the canvas accepts a preview card.
  useEffect(() => {
    const appWindow = getCurrentWindow();
    let cancelled = false;
    let stop: (() => void) | null = null;

    void appWindow
      .onDragDropEvent(async ({ payload }) => {
        if (payload.type !== "drop" || payload.paths.length === 0) return;
        const scale = await appWindow.scaleFactor();
        if (cancelled) return;
        const at = { x: payload.position.x / scale, y: payload.position.y / scale };
        const bounds = main.current?.getBoundingClientRect();
        if (
          !bounds ||
          at.x < bounds.left ||
          at.x > bounds.right ||
          at.y < bounds.top ||
          at.y > bounds.bottom
        ) {
          return;
        }
        openFiles(payload.paths, at);
      })
      .then((unlisten) => {
        if (cancelled) unlisten();
        else stop = unlisten;
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
      stop?.();
    };
  }, [openFiles]);

  // The repositories taken off the canvas by the mark beside their name. Held
  // by id rather than by folder: one folder can hold several repositories, and
  // closing one of them says nothing about the others found beside it.
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());

  const closeRepository = useCallback((repository: Repository) => {
    setClosed((current) => new Set(current).add(repository.id));
  }, []);

  // A repository that is no longer scanned is forgotten rather than remembered
  // as closed: taking its folder off the graph and putting it back is how one
  // is asked for again, and a repository that stayed closed through that would
  // be a folder that was graphed and drew nothing.
  useEffect(() => {
    setClosed((current) => {
      if (current.size === 0) return current;
      const scanned = new Set(workspace?.repositories.map((repository) => repository.id));
      const kept = [...current].filter((id) => scanned.has(id));
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [workspace]);

  /**
   * What the graph draws: everything the folders turned up, less what has been
   * closed.
   *
   * Closing one is about the canvas and nothing else — the folder stays open
   * and watched, and a session running in that repository carries on running,
   * so the band comes back with its terminals still on it.
   */
  const drawn = useMemo(() => {
    if (!workspace || closed.size === 0) return workspace;
    return {
      ...workspace,
      repositories: workspace.repositories.filter((repository) => !closed.has(repository.id)),
    };
  }, [workspace, closed]);

  // The menus the graph can open are fetched in the idle moments after the
  // window opens, so the first click does not have to wait for their chunks.
  useEffect(() => warmInTurn([commitPart, worktreePart, settingsPart]), []);

  // The terminal waits for a canvas. It is the largest part by some way — an
  // emulator, and half of everything this window can load — and there is no way
  // to ask for one until there is something on the graph to ask from, so
  // fetching it at boot would be the heaviest thing on the thread during the
  // seconds the column is actually being read.
  useEffect(() => (workspace ? warmInTurn([panelPart]) : undefined), [workspace]);

  // The graph is always asked for. Each other part is requested once there is
  // something for it to draw, then kept in hand because closing a menu is a
  // fade and unmounting it immediately would make it vanish instead.
  const GitGraph = graphPart.use();
  const SidePanel = panelPart.use(useEver(sessions.length > 0));
  const CommitMenu = commitPart.use(useEver(commitMenu !== null));
  const WorktreeMenu = worktreePart.use(useEver(worktreeMenu !== null));
  const SettingsDialog = settingsPart.use(useEver(settingsOpen));

  /**
   * Opens a terminal in a branch.
   *
   * A branch that has no worktree yet gets one here, on the way in: a branch
   * you can see is a branch you can work in, and the directory it needs is
   * derived rather than asked for — so there is nothing to decide and nothing
   * to distinguish a branch that has one from a branch that does not.
   */
  const openWork = useCallback(
    ({ repository, branch, cwd }: WorkRequest) => {
      // A folder is already a directory, so there is nothing to make; only a
      // branch that has never been checked out is answered with a worktree.
      const start = cwd
        ? Promise.resolve(cwd)
        : repository
          ? openWorkspace(repository.id, branch).then((workspace) => workspace.path)
          : Promise.reject(new Error("nowhere to open"));

      start
        .then((path) => openSession(shellSession(path, branch)))
        // Nothing to mark when there is no branch: a folder that would not open
        // is the shell saying so, in the terminal that was asked for.
        .catch(() => repository && fail(branchMark(repository.id, branch)));
    },
    [openSession, fail],
  );

  // What the last change was is not reported. The graph has already moved:
  // the commit is drawn, the ring has filled, the branch is where it now is —
  // and a line of text saying so was the same news a second time.

  // Clicking a commit is how work starts from it: the graph already answers
  // everything else about a commit, so there is nothing to open a panel for.
  const pickCommit = useCallback((node: CommitFlowNode, at: { x: number; y: number }) => {
    const { repository, commit } = node.data;
    setCommitMenu({ repository, commit, at });
  }, []);

  const merge = useCallback(
    ({ repository, source, target }: MergeRequest) => {
      // The branch being merged into is the one that changes, so it is the one
      // that waits — and the one that goes red when git will not do it.
      const key = branchMark(repository.id, target);
      hold(key);
      mergeBranch(repository.id, source, target)
        .then(() => release(key))
        .catch(() => {
          release(key);
          fail(key);
        });
    },
    [fail, hold, release],
  );

  /** Something the whole window depends on is not answering. */
  const stalled = gitMissing || failed;

  return (
    <Box
      sx={{ position: "relative", display: "flex", height: "100vh", bgcolor: "background.default" }}
    >
      <FolderSidebar
        initialFolders={initialFolders}
        onExpandedChange={setRoots}
        onFoldersChange={(folders) => localStorage.setItem(ROOTS_KEY, JSON.stringify(folders))}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenFile={(path) => openFiles([path], null)}
      />

      {/* No toolbar: the graph owns the whole pane. */}
      <Box
        ref={main}
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
          openFiles([path], { x: event.clientX, y: event.clientY });
        }}
        sx={{ position: "relative", flex: 1, minWidth: 0 }}
      >
        {/* Where the title bar was. Nothing is drawn there and the graph runs
            underneath it, but the band still picks the window up and still
            fills the screen on a double click — the two things a title bar is
            for, kept without the bar. This half only: the same band over the
            column is the sidebar's own header, which carries its two marks and
            picks the window up around them. */}
        <Box
          data-tauri-drag-region
          sx={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            height: HEADER_HEIGHT,
            zIndex: 1100,
            cursor: "grab",
            // Nothing at all until the pointer is on it, and then barely
            // anything: a band that is drawn all the time is a title bar, which
            // is the row this window went without. The wash is the whole of
            // what it says — the shape of the band is the message, and a mark
            // drawn inside it would be a second one saying the same thing.
            opacity: 0,
            bgcolor: "action.hover",
            transition: "opacity 120ms ease-out",
            "&:hover": { opacity: 1 },
          }}
        />
        {/* A scan that is still running, and a window that cannot get an
            answer at all. Both are one hairline along the top of the canvas —
            moving while it is working, red and still when it has stopped. The
            canvas underneath stays whatever it was, which is the rest of the
            answer: nothing has been drawn yet, or nothing new can be. */}
        {loading && (
          <LinearProgress
            sx={{ position: "absolute", top: 0, left: 0, right: 0, height: 2, zIndex: 1200 }}
          />
        )}
        {!loading && stalled && (
          <Box
            sx={{
              position: "absolute",
              top: 0,
              left: 0,
              right: 0,
              height: 2,
              zIndex: 1200,
              bgcolor: "error.main",
            }}
          />
        )}

        {GitGraph && (
          <GitGraph
            workspace={drawn ?? EMPTY_WORKSPACE}
            folders={folders}
            sessions={sessions}
            showing={showing}
            asks={asks}
            onAnswer={answerAsk}
            marks={marks}
            onSelect={pickCommit}
            onOpenWork={openWork}
            onPickBranch={(pick: BranchPick) => setWorktreeMenu(pick)}
            onCloseRepository={closeRepository}
            onMerge={merge}
            onShowSession={showSession}
            onEndSession={endSession}
            filePreviews={filePreviews}
            onCloseFilePreview={closeFilePreview}
          />
        )}
      </Box>

      {/* Stood up with the first session and kept from then on: the panel holds
          the terminals, and a terminal that is unmounted comes back empty. */}
      {SidePanel && <SidePanel sessions={sessions} showing={showing} onEnded={endSession} />}

      {/* The window has no frame of its own, so the three moves it would have
          carried are drawn over the corner instead. */}
      <WindowControls />

      {CommitMenu && <CommitMenu target={commitMenu} onClose={() => setCommitMenu(null)} />}
      {WorktreeMenu && (
        <WorktreeMenu
          target={worktreeMenu}
          onClose={() => setWorktreeMenu(null)}
          onOpen={openSession}
          onEndAttached={endSessionsIn}
        />
      )}
      {SettingsDialog && (
        <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} />
      )}
    </Box>
  );
}

/**
 * True from the first moment it is, and true from then on.
 *
 * What a menu is wanted for outlasts the moment it is asked for: closing one is
 * a fade, and a menu taken down the frame it was told to close would vanish
 * instead of closing. So the asking is remembered, and what it costs is a part
 * kept in hand drawing nothing.
 */
function useEver(wanted: boolean): boolean {
  const asked = useRef(false);
  asked.current ||= wanted;
  return asked.current;
}

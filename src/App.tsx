import { Box, CssBaseline } from "@mui/material";
import { ThemeProvider } from "@mui/material/styles";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { CommitTarget } from "./components/CommitMenu";
import type { BranchPick } from "./components/GitGraph";
import { WindowBand } from "./components/WindowBand";
import { WindowControls } from "./components/WindowControls";
import type { WorktreeTarget } from "./components/WorktreeMenu";
import { type FolderDestination, FolderSidebar } from "./folder/FolderSidebar";
import { useAskActions } from "./hooks/useAskActions";
import { useAsks } from "./hooks/useAsks";
import { useAutoFollow } from "./hooks/useAutoFollow";
import { useCanvasWork } from "./hooks/useCanvasWork";
import { useDoings } from "./hooks/useDoings";
import { useDrops } from "./hooks/useDrops";
import { useFileDrops } from "./hooks/useFileDrops";
import { useMarks } from "./hooks/useMarks";
import { useReports } from "./hooks/useReports";
import { useServing } from "./hooks/useServing";
import { useSessionKeys } from "./hooks/useSessionKeys";
import { useSessions } from "./hooks/useSessions";
import { useTaskKeys } from "./hooks/useTaskKeys";
import { useGitMissing, useWorkspaces } from "./hooks/useWorkspace";
import { FILE_DRAG_TYPE } from "./lib/filePreview";
import type { CliPlace } from "./lib/graphNav";
import { warmInTurn } from "./lib/onDemand";
import { startShell, writeShell } from "./lib/pty";
import { type Session, shellSession } from "./lib/session";
import { confirmFront, watchUpdateChoices } from "./lib/update";
import {
  commitPart,
  EMPTY_WORKSPACE,
  graphPart,
  panelPart,
  ROOTS_KEY,
  settingsPart,
  storedRoots,
  tasksPart,
  worktreePart,
} from "./parts";
import { MODE_KEY, storedMode, theme } from "./theme";
import type { Repository } from "./types/git";

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
  const [folderDestination, setFolderDestination] = useState<FolderDestination | null>(null);
  const [commitMenu, setCommitMenu] = useState<CommitTarget | null>(null);
  const [worktreeMenu, setWorktreeMenu] = useState<WorktreeTarget | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const openSettings = useCallback(() => setSettingsOpen(true), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  // This lives with the window rather than inside the settings page: a
  // remembered server must come back when the app starts, without waiting for
  // its settings page to be opened first.
  const mcp = useServing();
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
    jump: jumpSession,
    end: endSession,
    endIn: endSessionsIn,
  } = useSessions();

  // Where each terminal stands among all of them, which is the canvas's reading
  // and the panel's strip. Held by the window because the two are on either
  // side of it: the numbers come out of where the marks were laid out, and the
  // panel is what somebody is looking at when they want to know which of them
  // they are in.
  const [run, setRun] = useState<readonly CliPlace[]>([]);
  const takeRun = useCallback((next: readonly CliPlace[]) => {
    setRun((held) => (sameRun(held, next) ? held : next));
  }, []);

  // What any of them has stopped to ask, which the graph draws beside the
  // terminal doing the asking. A question is a turn nobody has taken: it is
  // worth seeing from the canvas, and worth being able to answer from there.
  const { asks, answer, reply, point, pick, take } = useAsks();

  // And what any of them says it is working on, which is the other half of what
  // the graph can show about a running agent. Nothing is waiting on this one —
  // it is read rather than answered — and it is empty until the window is
  // standing a server for the agents to say it through.
  const reports = useReports();
  // And what every one of them is doing, which is what its own mark draws: an
  // agent, something running, or a shell waiting to be typed at.
  const doings = useDoings();

  // Ctrl and A, which puts another terminal in the workspace the panel is
  // showing. Held here rather than in the graph: it is about what is running,
  // not about anything drawn on the canvas.
  useSessionKeys({ sessions, showing, open: openSession });

  // Ctrl and Alt and A, the key beside it: what the workspace's own runners say
  // can be run in there.
  const { asking: runnable, close: closeTasks } = useTaskKeys({ sessions, showing });

  /**
   * Runs one of them, which is a terminal of its own with the line typed into
   * it.
   *
   * A second terminal rather than the one in the panel, for the reason Ctrl and
   * A opens one: what is already running in there is somebody's -- an agent
   * mid-question, a build, an editor -- and a line typed into that is a line
   * typed into whatever it is doing. The line goes in once the shell is up,
   * which `startShell` is what says: it is the same promise the session was
   * opened on, so asking again is asking the first one whether it is finished.
   */
  const runTask = useCallback(
    (session: Session, line: string) => {
      closeTasks();
      const next = shellSession(session.cwd, session.branch);
      openSession(next);
      void startShell(next)
        .then(() => writeShell(next.id, `${line}\n`))
        .catch(() => undefined);
    },
    [closeTasks, openSession],
  );

  const { workspace, folders, loading, failed } = useWorkspaces(roots);
  const gitMissing = useGitMissing(roots);
  // Every branch kept up with its remote on a slow loop, while the settings
  // page's one checkbox says to. Held with the window rather than with the
  // graph: it is about repositories and not about what is drawn of them, and it
  // has to run whether or not that page has ever been opened.
  useAutoFollow(workspace?.repositories ?? EMPTY_WORKSPACE.repositories);
  const { filePreviews, openFiles, previewFile, closeFilePreview } = useFileDrops();
  // Everything dropped on the window, wherever it was dragged from: a folder
  // in the column takes a copy, and the canvas opens a card. See `useDrops`.
  const drops = useDrops(main, openFiles);
  const { answerAsk, replyToAsk, pointAtAsk, pickInAsk, takeAsking } = useAskActions({
    answer,
    reply,
    point,
    pick,
    take,
  });

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

  /** What the graph draws: everything the folders turned up, less what has been
   *  closed. Closing is about the canvas and nothing else — the folder stays open
   *  and watched, and its sessions carry on running. */
  const drawn = useMemo(() => {
    if (!workspace || closed.size === 0) return workspace;
    return {
      ...workspace,
      repositories: workspace.repositories.filter((repository) => !closed.has(repository.id)),
    };
  }, [workspace, closed]);

  // The window has been drawn, which is what a front taken from a release is
  // waiting to be told: until one window has got this far out of it, the next
  // start of the app throws it away rather than open on it. Said here because
  // this is the first moment the whole of the window exists, and said out of
  // every window because none of them knows which front it was drawn from.
  useEffect(confirmFront, []);

  // Which compatible releases there are, kept up to date from here on: a list only asked
  // for when the pull-down is opened is a list that is empty at the moment
  // somebody looks at it. See `watchUpdateChoices`.
  useEffect(watchUpdateChoices, []);

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
  const browseFolder = useCallback(
    (repository: Repository, path: string) => {
      const root = folders.find((folder) => folder.repositories.includes(repository.id))?.root;
      if (root) setFolderDestination({ root, path });
    },
    [folders],
  );

  const { openWork, browseWorktree, pickCommit, merge, sync, fetch } = useCanvasWork({
    openSession,
    fail,
    hold,
    release,
    setCommitMenu,
    onBrowseFolder: browseFolder,
  });
  const stalled = gitMissing || failed;

  const GitGraph = graphPart.use();
  const SidePanel = panelPart.use(useEver(sessions.length > 0));
  const CommitMenu = commitPart.use(useEver(commitMenu !== null));
  const WorktreeMenu = worktreePart.use(useEver(worktreeMenu !== null));
  const TaskMenu = tasksPart.use(useEver(runnable !== null));

  return (
    <Box
      sx={{ position: "relative", display: "flex", height: "100vh", bgcolor: "background.default" }}
    >
      <FolderSidebar
        initialFolders={initialFolders}
        onExpandedChange={setRoots}
        onFoldersChange={(folders) => localStorage.setItem(ROOTS_KEY, JSON.stringify(folders))}
        onOpenSettings={openSettings}
        onOpenFile={(path) => openFiles([path], null)}
        drops={drops}
        destination={folderDestination}
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
        <WindowBand loading={loading} stalled={stalled} />

        {GitGraph && (
          <GitGraph
            workspace={drawn ?? EMPTY_WORKSPACE}
            folders={folders}
            sessions={sessions}
            showing={showing}
            asks={asks}
            reports={reports}
            doings={doings}
            onAnswer={answerAsk}
            onReply={replyToAsk}
            onPoint={pointAtAsk}
            onPick={pickInAsk}
            onTake={takeAsking}
            marks={marks}
            onSelect={pickCommit}
            onOpenWork={openWork}
            onBrowseWorktree={browseWorktree}
            onPickBranch={(pick: BranchPick) => setWorktreeMenu(pick)}
            onCloseRepository={closeRepository}
            onMerge={merge}
            onSync={sync}
            onFetch={fetch}
            onShowSession={showSession}
            onJumpSession={jumpSession}
            onEndSession={endSession}
            onCliRun={takeRun}
            filePreviews={filePreviews}
            onPreviewFile={previewFile}
            onCloseFilePreview={closeFilePreview}
            settingsOpen={settingsOpen}
            mcp={mcp}
            onCloseSettings={closeSettings}
          />
        )}
      </Box>

      {/* Stood up with the first session and kept from then on: the panel holds
          the terminals, and a terminal that is unmounted comes back empty. */}
      {SidePanel && (
        <SidePanel sessions={sessions} showing={showing} run={run} onEnded={endSession} />
      )}

      {/* The window has no frame of its own, so the three moves it would have
          carried are drawn over the corner instead. */}
      <WindowControls />

      {TaskMenu && <TaskMenu session={runnable} onClose={closeTasks} onRun={runTask} />}

      {/* A branch cut from a commit comes up with a terminal already in it, so
          the menu is handed the same opener the branch heads use. */}
      {CommitMenu && (
        <CommitMenu target={commitMenu} onClose={() => setCommitMenu(null)} onOpen={openSession} />
      )}
      {WorktreeMenu && (
        <WorktreeMenu
          target={worktreeMenu}
          onClose={() => setWorktreeMenu(null)}
          onOpen={openSession}
          onEndAttached={endSessionsIn}
        />
      )}
    </Box>
  );
}

/**
 * Whether two readings of the run are the same one.
 *
 * The canvas says it again for every graph it draws, which is one per commit
 * that lands anywhere: a reading that says what the last one did is the same
 * reading, and putting it in state would re-render the window for nothing.
 */
function sameRun(held: readonly CliPlace[], next: readonly CliPlace[]): boolean {
  return (
    held.length === next.length &&
    held.every((place, at) => {
      const against = next[at];
      return place.session === against?.session && place.group === against.group;
    })
  );
}

/** True from the first moment it is, and true from then on: closing a menu is a
 *  fade, and one taken down the frame it was told to close would vanish instead
 *  of closing. */
function useEver(wanted: boolean): boolean {
  const asked = useRef(false);
  asked.current ||= wanted;
  return asked.current;
}

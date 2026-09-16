import { Box, Divider, Stack } from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { createEntry, renameFile } from "../folder/api";
import { DROP_INTO, folderUnder } from "../folder/dropInto";
import { baseName } from "../folder/format";
import type { Drops } from "../hooks/useDrops";
import { FILE_DRAG_TYPE } from "../lib/filePreview";
import type { Graphed, PaneSeed } from "../lib/graphed";
import type { Homes } from "../lib/worktrees";
import { AddMark, Frame, MARK_BUTTON, MarkButton, SettingsMark } from "../marks";
import { HEADER_INSET } from "../window/WindowControls";
import { FileContextMenu, type FileMenuTarget } from "./left/FileContextMenu";
import { FolderPane } from "./left/FolderPane";
import type { Naming } from "./left/NameField";
import { RepoPane } from "./left/RepoPane";
import { RootsMenu } from "./left/RootsMenu";
import { type FolderDestination, shownPath, usePanes } from "./left/usePanes";
import { Sidebar, type Sizing } from "./Sidebar";

export type { FolderDestination, Pane } from "./left/usePanes";

const SIZING: Sizing = { min: 200, max: 560, initial: 288, storageKey: "totex.sidebarWidth" };

export interface LeftSidebarProps {
  open: boolean;
  onClose: () => void;
  /** Where the panes stood last run. */
  initialPanes?: readonly PaneSeed[];
  /** What is on the canvas, by kind. */
  onGraphedChange?: (graphed: Graphed[]) => void;
  /** Where the panes stand, kept between runs. */
  onPanesChange?: (panes: PaneSeed[]) => void;
  /** The directories being read: they light the worktrees they stand in. */
  onBrowsingChange?: (paths: string[]) => void;
  onOpenSettings?: () => void;
  onOpenFile?: (path: string) => void;
  drops: Drops;
  destination?: FolderDestination | null;
  homes?: Homes;
  /** Worktree path to the branch it is on, for a repository row showing one. */
  branches?: ReadonlyMap<string, string>;
}

const NO_BRANCHES: ReadonlyMap<string, string> = new Map();

/**
 * Browsing costs one directory read; putting a place on the canvas is asked for by its own mark,
 * as the folder it is or as the one repository it is.
 */
export function LeftSidebar({
  open,
  onClose,
  initialPanes,
  onGraphedChange,
  onPanesChange,
  onBrowsingChange,
  onOpenSettings,
  onOpenFile,
  drops,
  destination,
  homes,
  branches,
}: LeftSidebarProps) {
  const { t } = useTranslation();
  const panes = usePanes(
    initialPanes ?? [],
    onGraphedChange,
    onPanesChange,
    onBrowsingChange,
    destination,
    homes,
  );
  const [menu, setMenu] = useState<FileMenuTarget | null>(null);
  // Held by the column, not the level: the levels open their way down to the folder being named, so
  // the name has to outlast them.
  const [naming, setNaming] = useState<Naming | null>(null);
  // A list's root has no level to type a name in, so the last folder pane answers for the blank.
  const under = [...panes.panes].reverse().find((pane) => pane.kind === "folder") ?? null;

  function startName(kind: Naming["kind"], target: FileMenuTarget) {
    setMenu(null);
    setNaming({
      pane: target.pane,
      kind,
      folder: target.into,
      path: kind === "rename" ? target.path : null,
      from: kind === "rename" ? target.name : "",
    });
    const pane = panes.panes.find((held) => held.id === target.pane);
    if (pane?.kind === "repository") {
      // `root` is the row's shown path; the row is opened out so the levels can reach the folder.
      const repository =
        Object.keys(pane.shown).find((held) => shownPath(pane, held) === target.root) ??
        target.root;
      panes.expandRow(pane.id, repository);
      return;
    }
    panes.update(target.pane, { open: true });
  }

  async function takeName(name: string) {
    if (!naming) return;
    if (naming.path) await renameFile(naming.path, name);
    else await createEntry(naming.folder, name, naming.kind === "new-folder");
    setNaming(null);
  }

  const carrying = (transfer: DataTransfer) => transfer.types.includes(FILE_DRAG_TYPE);

  return (
    <Sidebar
      id="folder-sidebar"
      side="left"
      open={open}
      sizing={SIZING}
      onDragOver={(event) => {
        if (!carrying(event.dataTransfer)) return;
        const folder = folderUnder(event.clientX, event.clientY);
        drops.mark(folder);
        if (!folder) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) drops.mark(null);
      }}
      onDrop={(event) => {
        if (!carrying(event.dataTransfer)) return;
        const path = event.dataTransfer.getData(FILE_DRAG_TYPE);
        const folder = folderUnder(event.clientX, event.clientY);
        drops.mark(null);
        if (!path || !folder) return;
        event.preventDefault();
        drops.take([path], folder);
      }}
      band={
        <>
          <Stack
            direction="row"
            spacing={0.25}
            sx={{
              position: "relative",
              height: "100%",
              alignItems: "flex-end",
              pl: `${HEADER_INSET}px`,
              pr: `${HEADER_INSET + MARK_BUTTON + 2}px`,
              pointerEvents: "none",
              "& > *": { pointerEvents: "auto" },
            }}
          >
            {/* One mark for both kinds of pane: the menu it opens has the choice. */}
            <MarkButton label={t("folder.add")} onClick={(event) => panes.openRootMenu(event)}>
              <AddMark />
            </MarkButton>
            {onOpenSettings && (
              <MarkButton label={t("folder.settings")} onClick={onOpenSettings}>
                <SettingsMark />
              </MarkButton>
            )}
          </Stack>
          <Box sx={{ position: "absolute", top: HEADER_INSET, right: HEADER_INSET }}>
            <MarkButton
              label={t("folder.collapseSidebar")}
              aria-expanded={open}
              aria-controls="folder-sidebar"
              onClick={onClose}
            >
              <Frame>
                <path d="M15 6 9 12 15 18" />
              </Frame>
            </MarkButton>
          </Box>
        </>
      }
    >
      <RootsMenu {...panes} />

      <Box
        ref={panes.column}
        sx={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          overflowY: "auto",
        }}
      >
        {panes.panes.map((pane, index) => (
          <Box key={pane.id} data-folder-pane={pane.id}>
            {index > 0 && <Divider />}
            {pane.kind === "repository" ? (
              <RepoPane
                id={pane.id}
                path={pane.path}
                open={pane.open}
                graphed={pane.graphed}
                expanded={pane.expanded}
                shown={pane.shown}
                branches={branches ?? NO_BRANCHES}
                dropping={drops.into}
                refused={drops.refused}
                onToggleOpen={() => panes.update(pane.id, { open: !pane.open })}
                onToggleGraph={(repository) => panes.toggleGraph(pane.id, repository)}
                onToggleExpanded={(repository) => {
                  if (naming?.pane === pane.id) setNaming(null);
                  panes.toggleExpanded(pane.id, repository);
                }}
                onShowWorktree={(repository, path) => {
                  if (naming?.pane === pane.id) setNaming(null);
                  panes.showWorktree(pane.id, repository, path);
                }}
                onListed={(repositories) => panes.settleList(pane.id, repositories)}
                onOpenFile={onOpenFile}
                onMenu={setMenu}
                naming={naming?.pane === pane.id ? naming : null}
                onNameDone={takeName}
                onNameCancel={() => setNaming(null)}
                onClose={() => {
                  if (naming?.pane === pane.id) setNaming(null);
                  panes.setPanes((current) => current.filter((held) => held.id !== pane.id));
                }}
              />
            ) : (
              <FolderPane
                id={pane.id}
                path={pane.path}
                open={pane.open}
                graphed={pane.graphed}
                dropping={drops.into}
                refused={drops.refused}
                onNavigate={(path) => {
                  if (naming?.pane === pane.id) setNaming(null);
                  panes.update(pane.id, { path });
                }}
                onToggleOpen={() => panes.update(pane.id, { open: !pane.open })}
                onToggleGraph={(path) => panes.toggleGraph(pane.id, path)}
                onListRepositories={(path) => panes.addPane(path, "repository")}
                onOpenFile={onOpenFile}
                onMenu={setMenu}
                naming={naming?.pane === pane.id ? naming : null}
                onNameDone={takeName}
                onNameCancel={() => setNaming(null)}
                onClose={() => {
                  if (naming?.pane === pane.id) setNaming(null);
                  panes.setPanes((current) => current.filter((held) => held.id !== pane.id));
                }}
              />
            )}
          </Box>
        ))}

        {/* The blank space under the folders is the window's handle. */}
        <Box
          data-tauri-drag-region
          {...(under ? { [DROP_INTO]: under.path } : null)}
          sx={{ flex: 1, minHeight: 48 }}
          onContextMenu={
            under
              ? (event) => {
                  event.preventDefault();
                  setMenu({
                    path: under.path,
                    name: baseName(under.path),
                    isDir: true,
                    into: under.path,
                    root: under.path,
                    pane: under.id,
                    at: { x: event.clientX, y: event.clientY },
                  });
                }
              : undefined
          }
        />
      </Box>

      <FileContextMenu
        target={menu}
        onName={(kind) => menu && startName(kind, menu)}
        onClose={() => setMenu(null)}
      />
    </Sidebar>
  );
}

import { Box, Divider, Stack } from "@mui/material";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { createEntry, renameFile } from "../folder/api";
import { DROP_INTO, folderUnder } from "../folder/dropInto";
import { baseName } from "../folder/format";
import type { Drops } from "../hooks/useDrops";
import { FILE_DRAG_TYPE } from "../lib/filePreview";
import type { Homes } from "../lib/worktrees";
import { AddMark, Frame, MARK_BUTTON, MarkButton, SettingsMark } from "../marks";
import { HEADER_INSET } from "../window/WindowControls";
import { FileContextMenu, type FileMenuTarget } from "./left/FileContextMenu";
import { FolderPane } from "./left/FolderPane";
import type { Naming } from "./left/NameField";
import { RootsMenu } from "./left/RootsMenu";
import { type FolderDestination, usePanes } from "./left/usePanes";
import { Sidebar, type Sizing } from "./Sidebar";

export type { FolderDestination, Pane } from "./left/usePanes";

const SIZING: Sizing = { min: 200, max: 560, initial: 288, storageKey: "totex.sidebarWidth" };

export interface LeftSidebarProps {
  open: boolean;
  onClose: () => void;
  initialFolders?: string[];
  onExpandedChange?: (paths: string[]) => void;
  onFoldersChange?: (paths: string[]) => void;
  onOpenSettings?: () => void;
  onOpenFile?: (path: string) => void;
  drops: Drops;
  destination?: FolderDestination | null;
  homes?: Homes;
}

/**
 * Browsing costs one directory read; putting a folder on the canvas is asked for by its own mark.
 */
export function LeftSidebar({
  open,
  onClose,
  initialFolders,
  onExpandedChange,
  onFoldersChange,
  onOpenSettings,
  onOpenFile,
  drops,
  destination,
  homes,
}: LeftSidebarProps) {
  const { t } = useTranslation();
  const panes = usePanes(
    initialFolders ?? [],
    onFoldersChange,
    onExpandedChange,
    destination,
    homes,
  );
  const [menu, setMenu] = useState<FileMenuTarget | null>(null);
  // Held by the column, not the level: the levels open their way down to the folder being named, so
  // the name has to outlast them.
  const [naming, setNaming] = useState<Naming | null>(null);
  const under = panes.panes.at(-1) ?? null;

  function startName(kind: Naming["kind"], target: FileMenuTarget) {
    setMenu(null);
    setNaming({
      pane: target.pane,
      kind,
      folder: target.into,
      path: kind === "rename" ? target.path : null,
      from: kind === "rename" ? target.name : "",
    });
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
            <MarkButton label={t("folder.add")} onClick={panes.openRootMenu}>
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

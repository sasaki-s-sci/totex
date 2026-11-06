import { Box } from "@mui/material";
import { baseName } from "../../folder/format";
import type { FileMenuTarget } from "./FileContextMenu";
import { Level } from "./FolderLevel";
import type { Naming } from "./NameField";
import { PaneHeader } from "./PaneHeader";
import type { PaneGrip } from "./paneOrder";
import { useSelection } from "./selection";

export interface FolderPaneProps {
  /** Two panes can show one folder, so a row is named by pane as well as path. */
  id: number;
  /** The pane asks to be moved; it does not move itself. */
  path: string;
  /** Display only: shutting the rows says nothing about the graph. */
  open: boolean;
  graphed: readonly string[];
  dropping: string | null;
  refused: string | null;
  onNavigate: (path: string) => void;
  onToggleOpen: () => void;
  /** The only way onto the graph, and as a folder: nothing under it is scanned. */
  onToggleGraph: (path: string) => void;
  /** Opens the directory in a separate folder pane. */
  onAddFolder: (path: string) => void;
  /** The pane turns into the repository pane for the checkout it stands in. */
  onGitMode: () => void;
  onOpenFile?: (path: string, folder: string) => void;
  onMenu: (target: FileMenuTarget) => void;
  /** Held by the column, like the menu; see `Naming`. */
  naming: Naming | null;
  onNameDone: (name: string) => Promise<void>;
  onNameCancel: () => void;
  onClose: () => void;
  /** Picks the pane up by its header, to put it elsewhere in the column. */
  grip?: PaneGrip;
}

/**
 * A folder row opens in place; `jump` moves the pane there. The graph is separate and asked for by
 * its own mark.
 */
export function FolderPane({
  id,
  path,
  open: showing,
  graphed,
  dropping,
  refused,
  onNavigate,
  onToggleOpen,
  onToggleGraph,
  onAddFolder,
  onGitMode,
  onOpenFile,
  onMenu,
  naming,
  onNameDone,
  onNameCancel,
  onClose,
  grip,
}: FolderPaneProps) {
  const { selected, pick, point, pane, onKeyDown } = useSelection(path);
  const name = baseName(path);

  return (
    /* Anything that is not a row answers for the pane's own folder; a row stops the press first. */
    <Box
      component="section"
      ref={pane}
      onKeyDown={onKeyDown}
      sx={{ pb: 0.5 }}
      onContextMenu={(event) => {
        event.preventDefault();
        onMenu({
          path,
          entries: [{ path, isDir: true }],
          name,
          isDir: true,
          into: path,
          root: path,
          pane: id,
          at: { x: event.clientX, y: event.clientY },
        });
      }}
    >
      <PaneHeader
        path={path}
        kind="folder"
        open={showing}
        graphed={graphed.includes(path)}
        dropping={dropping}
        refused={refused}
        grip={grip}
        onSwitchMode={onGitMode}
        onToggleOpen={onToggleOpen}
        onToggleGraph={() => onToggleGraph(path)}
        onAddFolder={onAddFolder}
        onNavigate={onNavigate}
        onClose={onClose}
      />

      {showing && (
        <Level
          key={path}
          pane={id}
          path={path}
          root={path}
          depth={0}
          graphed={graphed}
          selected={selected}
          dropping={dropping}
          refused={refused}
          onPick={pick}
          onPoint={point}
          onNavigate={onNavigate}
          onToggleGraph={onToggleGraph}
          onAddFolder={onAddFolder}
          onOpenFile={onOpenFile}
          // The levels below know nothing about which pane draws them.
          onMenu={(target) => onMenu({ ...target, pane: id })}
          naming={naming}
          onNameDone={onNameDone}
          onNameCancel={onNameCancel}
        />
      )}
    </Box>
  );
}

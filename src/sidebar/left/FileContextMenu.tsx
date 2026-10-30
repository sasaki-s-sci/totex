import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import ContentPasteIcon from "@mui/icons-material/ContentPaste";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import DriveFileRenameOutlineIcon from "@mui/icons-material/DriveFileRenameOutline";
import FileCopyOutlinedIcon from "@mui/icons-material/FileCopyOutlined";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import NotesOutlinedIcon from "@mui/icons-material/NotesOutlined";
import RouteOutlinedIcon from "@mui/icons-material/RouteOutlined";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Snackbar,
} from "@mui/material";
import { type ReactNode, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";
import {
  copyInto,
  deleteFile,
  deleteFolder,
  downloadEntry,
  duplicateFile,
  readFile,
} from "../../folder/api";
import { baseName, displayPath } from "../../folder/format";
import { copyText } from "../../lib/clipboard";
import { type SelectionEntry, topLevelEntries } from "../../lib/fileSelection";
import type { Naming } from "./NameField";

export type FileMenuTarget = {
  /** The row pointed at; single-entry actions require it to be the only selection. */
  path: string;
  entries: readonly SelectionEntry[];
  action?: "delete";
  name: string;
  isDir: boolean;
  /** Inside a folder, or beside a file in the directory listing it; also where a name is typed. */
  into: string;
  root: string;
  /** Two panes can show one folder; the name is typed in one of them. */
  pane: number;
  at: { x: number; y: number };
};

type Props = {
  target: FileMenuTarget | null;
  /** Held by the column, so what is copied in one pane is pasted in another. */
  copied: readonly string[];
  onCopy: (paths: readonly string[]) => void;
  onName: (kind: Naming["kind"]) => void;
  onClose: () => void;
};

export function FileContextMenu({ target, copied, onCopy, onName, onClose }: Props) {
  const { t } = useTranslation();
  /** Removal is still asked in a box: it cannot be undone and is not visible from the row. */
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [went, setWent] = useState<string | null>(null);
  const [remaining, setRemaining] = useState<readonly SelectionEntry[] | null>(null);
  const [naming, setNaming] = useState(false);

  useEffect(() => {
    setDeleting(target?.action === "delete");
    setRemaining(null);
    setNaming(false);
    setBusy(null);
    setFailed(false);
    setWent(null);
  }, [target]);

  if (!target) return null;
  const { path, isDir, root } = target;
  const entries = topLevelEntries(target.entries);
  const paths = entries.map((entry) => entry.path);
  const selectedPaths = target.entries.map((entry) => entry.path);
  const single = target.entries.length === 1;
  const pending = remaining ?? entries;
  // The folder a pane stands in is not offered for removal: the pane would be left showing a folder
  // that is not there.
  const removable = entries.length > 0 && entries.every((entry) => entry.path !== root);

  function name(kind: Naming["kind"]) {
    // Finish menu focus restoration before mounting the inline name field.
    flushSync(() => setNaming(true));
    onName(kind);
  }

  async function remove() {
    if (!removable) return;
    setBusy("delete");
    setFailed(false);
    const refused: SelectionEntry[] = [];
    for (const entry of pending) {
      try {
        await (entry.isDir ? deleteFolder(entry.path) : deleteFile(entry.path));
      } catch {
        refused.push(entry);
      }
    }
    if (refused.length === 0) onClose();
    else {
      setRemaining(refused);
      setFailed(true);
    }
    setBusy(null);
  }

  /** The menu shuts on its way out, except `tell`: an answer worth reading keeps it open. */
  const run = async (
    label: string,
    action: () => Promise<unknown>,
    tell?: (answer: unknown) => string,
  ) => {
    setBusy(label);
    setFailed(false);
    setWent(null);
    try {
      const answer = await action();
      if (!tell) return onClose();
      setWent(tell(answer));
      setBusy(null);
    } catch {
      setFailed(true);
      setBusy(null);
    }
  };

  return (
    <>
      <Menu
        open={!deleting}
        disableRestoreFocus={naming}
        onClose={busy ? undefined : onClose}
        anchorReference="anchorPosition"
        anchorPosition={{ top: target.at.y, left: target.at.x }}
        transformOrigin={{ vertical: "top", horizontal: "left" }}
        slotProps={{ paper: { sx: { minWidth: 218 } } }}
      >
        <FileItem
          icon={<InsertDriveFileOutlinedIcon />}
          label={t("file.newFile")}
          disabled={busy !== null}
          onClick={() => name("new-file")}
        />
        <FileItem
          icon={<FolderOutlinedIcon />}
          label={t("file.newFolder")}
          disabled={busy !== null}
          onClick={() => name("new-folder")}
        />
        <Divider />
        <FileItem
          icon={<ContentCopyIcon />}
          label={paths.length > 1 ? t("file.copyMany", { count: paths.length }) : t("file.copy")}
          disabled={busy !== null}
          onClick={() => {
            onCopy(paths);
            onClose();
          }}
        />
        {copied.length > 0 && (
          <FileItem
            icon={<ContentPasteIcon />}
            label={
              copied.length > 1 ? t("file.pasteMany", { count: copied.length }) : t("file.paste")
            }
            disabled={busy !== null}
            onClick={() => void run("paste", () => copyInto([...copied], target.into))}
          />
        )}
        {single && !isDir && (
          <FileItem
            icon={<NotesOutlinedIcon />}
            label={t("file.copyContents")}
            disabled={busy !== null}
            onClick={() => void run("copy-contents", () => copyContents(path))}
          />
        )}
        {single && !isDir && (
          <FileItem
            icon={<FileCopyOutlinedIcon />}
            label={t("file.duplicate")}
            disabled={busy !== null}
            onClick={() => void run("duplicate", () => duplicateFile(path))}
          />
        )}
        <Divider />
        <FileItem
          icon={<DownloadOutlinedIcon />}
          label={
            paths.length > 1 ? t("file.downloadMany", { count: paths.length }) : t("file.download")
          }
          disabled={busy !== null}
          onClick={() =>
            void run(
              "download",
              () => downloadEach(paths),
              (where) => (where as string[]).map(displayPath).join("\n"),
            )
          }
        />
        <Divider />
        <FileItem
          icon={<RouteOutlinedIcon />}
          label={t("file.copyPath")}
          disabled={busy !== null}
          onClick={() => void run("copy-path", () => copyText(selectedPaths.join("\n")))}
        />
        <FileItem
          icon={<RouteOutlinedIcon />}
          label={t("file.copyRelativePath")}
          disabled={busy !== null}
          onClick={() =>
            void run("copy-relative-path", () =>
              copyText(selectedPaths.map((one) => relativePath(root, one)).join("\n")),
            )
          }
        />
        {removable && <Divider />}
        {single && removable && (
          <FileItem
            icon={<DriveFileRenameOutlineIcon />}
            label={t("file.rename")}
            disabled={busy !== null}
            onClick={() => name("rename")}
          />
        )}
        {removable && (
          <FileItem
            icon={<DeleteOutlinedIcon />}
            label={
              entries.length > 1
                ? t("file.deleteMany", { count: entries.length })
                : t("file.delete")
            }
            disabled={busy !== null}
            colour="error.main"
            onClick={() => {
              setFailed(false);
              setDeleting(true);
            }}
          />
        )}
      </Menu>

      {/* Outside the menu: a row added inside it would make the menu taller and move it. */}
      <Snackbar
        open={failed || went !== null}
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      >
        <Alert
          severity={failed ? "error" : "success"}
          sx={{ whiteSpace: "pre-line", wordBreak: "break-all" }}
        >
          {failed ? t("file.failed") : t("file.downloaded", { path: went ?? "" })}
        </Alert>
      </Snackbar>

      <Dialog open={deleting} onClose={busy ? undefined : onClose}>
        <DialogTitle>
          {pending.length > 1
            ? t("file.deleteManyTitle", { count: pending.length })
            : t("file.deleteTitle", { name: baseName(pending[0]?.path ?? path) })}
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            {pending.length > 1
              ? t("file.deleteManyBody")
              : pending[0]?.isDir
                ? t("file.deleteFolderBody")
                : t("file.deleteBody")}
          </DialogContentText>
          {target.entries.length > 1 && (
            <ul>
              {pending.map((entry) => (
                <li key={entry.path}>{displayPath(entry.path)}</li>
              ))}
            </ul>
          )}
          {failed && <DialogContentText color="error">{t("file.failed")}</DialogContentText>}
        </DialogContent>
        <DialogActions>
          <Button disabled={busy !== null} onClick={onClose}>
            {t("file.cancel")}
          </Button>
          <Button
            color="error"
            disabled={busy !== null || !removable}
            onClick={() => void remove()}
          >
            {t("file.delete")}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function FileItem({
  icon,
  label,
  disabled,
  colour,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  disabled?: boolean;
  colour?: string;
  onClick: () => void;
}) {
  return (
    <MenuItem disabled={disabled} onClick={onClick} sx={colour ? { color: colour } : undefined}>
      <ListItemIcon sx={colour ? { color: colour } : undefined}>{icon}</ListItemIcon>
      <ListItemText>{label}</ListItemText>
    </MenuItem>
  );
}

/** One at a time: two copies racing for a free name in the same folder could pick the same one. */
async function downloadEach(paths: readonly string[]) {
  const where: string[] = [];
  for (const path of paths) where.push(await downloadEntry(path));
  return where;
}

async function copyContents(path: string) {
  const bytes = new Uint8Array(await readFile(path));
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  await copyText(text);
}

export function relativePath(root: string, path: string): string {
  const bare = root.replace(/[\\/]+$/, "");
  if (path === bare) return path.split(/[\\/]/).at(-1) ?? path;
  if (path.startsWith(`${bare}/`) || path.startsWith(`${bare}\\`)) {
    return path.slice(bare.length + 1);
  }
  return path;
}

import ContentCopyIcon from "@mui/icons-material/ContentCopy";
import DeleteOutlinedIcon from "@mui/icons-material/DeleteOutlined";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import DriveFileRenameOutlineIcon from "@mui/icons-material/DriveFileRenameOutline";
import FileCopyOutlinedIcon from "@mui/icons-material/FileCopyOutlined";
import FolderOutlinedIcon from "@mui/icons-material/FolderOutlined";
import InsertDriveFileOutlinedIcon from "@mui/icons-material/InsertDriveFileOutlined";
import RouteOutlinedIcon from "@mui/icons-material/RouteOutlined";
import {
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
} from "@mui/material";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { deleteFile, deleteFolder, downloadEntry, duplicateFile, readFile } from "../../folder/api";
import { displayPath } from "../../folder/format";
import type { Naming } from "./NameField";

export type FileMenuTarget = {
  path: string;
  name: string;
  /**
   * Folders are offered less: copy and rename are refused underneath; removal is `deleteFolder`.
   */
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
  onName: (kind: Naming["kind"]) => void;
  onClose: () => void;
};

export function FileContextMenu({ target, onName, onClose }: Props) {
  const { t } = useTranslation();
  /** Removal is still asked in a box: it cannot be undone and is not visible from the row. */
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [went, setWent] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the target itself is the opening
  useEffect(() => {
    setDeleting(false);
    setBusy(null);
    setFailed(false);
    setWent(null);
  }, [target]);

  if (!target) return null;
  const { path, isDir, root } = target;
  // The folder a pane stands in is not offered for removal: the pane would be left showing a folder
  // that is not there.
  const removable = !isDir || path !== root;

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
          onClick={() => onName("new-file")}
        />
        <FileItem
          icon={<FolderOutlinedIcon />}
          label={t("file.newFolder")}
          disabled={busy !== null}
          onClick={() => onName("new-folder")}
        />
        {!isDir && <Divider />}
        {!isDir && (
          <FileItem
            icon={<ContentCopyIcon />}
            label={t("file.copy")}
            disabled={busy !== null}
            onClick={() => void run("copy", () => copyContents(path))}
          />
        )}
        {!isDir && (
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
          label={t("file.download")}
          disabled={busy !== null}
          onClick={() =>
            void run(
              "download",
              () => downloadEntry(path),
              (where) => String(where),
            )
          }
        />
        <Divider />
        <FileItem
          icon={<RouteOutlinedIcon />}
          label={t("file.copyPath")}
          disabled={busy !== null}
          onClick={() => void run("copy-path", () => copyText(path))}
        />
        <FileItem
          icon={<RouteOutlinedIcon />}
          label={t("file.copyRelativePath")}
          disabled={busy !== null}
          onClick={() => void run("copy-relative-path", () => copyText(relativePath(root, path)))}
        />
        {removable && <Divider />}
        {!isDir && (
          <FileItem
            icon={<DriveFileRenameOutlineIcon />}
            label={t("file.rename")}
            disabled={busy !== null}
            onClick={() => onName("rename")}
          />
        )}
        {removable && (
          <FileItem
            icon={<DeleteOutlinedIcon />}
            label={t("file.delete")}
            disabled={busy !== null}
            colour="error.main"
            onClick={() => {
              setFailed(false);
              setDeleting(true);
            }}
          />
        )}
        {(failed || went) && (
          <MenuItem disabled sx={{ whiteSpace: "normal" }}>
            <ListItemText
              secondary={
                failed ? t("file.failed") : t("file.downloaded", { path: displayPath(went ?? "") })
              }
              slotProps={{ secondary: { sx: { wordBreak: "break-all" } } }}
            />
          </MenuItem>
        )}
      </Menu>

      <Dialog open={deleting} onClose={busy ? undefined : () => setDeleting(false)}>
        <DialogTitle>{t("file.deleteTitle", { name: target.name })}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {isDir ? t("file.deleteFolderBody") : t("file.deleteBody")}
          </DialogContentText>
          {failed && <DialogContentText color="error">{t("file.failed")}</DialogContentText>}
        </DialogContent>
        <DialogActions>
          <Button disabled={busy !== null} onClick={() => setDeleting(false)}>
            {t("file.cancel")}
          </Button>
          <Button
            color="error"
            disabled={busy !== null}
            onClick={() =>
              void run("delete", () => (isDir ? deleteFolder(path) : deleteFile(path)))
            }
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

async function copyContents(path: string) {
  const bytes = new Uint8Array(await readFile(path));
  const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  await copyText(text);
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return;
  } catch {
    const field = document.createElement("textarea");
    field.value = text;
    field.style.position = "fixed";
    field.style.opacity = "0";
    document.body.appendChild(field);
    field.select();
    const copied = document.execCommand("copy");
    field.remove();
    if (!copied) throw new Error("clipboard-unavailable");
  }
}

export function relativePath(root: string, path: string): string {
  const bare = root.replace(/[\\/]+$/, "");
  if (path === bare) return path.split(/[\\/]/).at(-1) ?? path;
  if (path.startsWith(`${bare}/`) || path.startsWith(`${bare}\\`)) {
    return path.slice(bare.length + 1);
  }
  return path;
}

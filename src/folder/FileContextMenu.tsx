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
import { deleteFile, deleteFolder, downloadEntry, duplicateFile, readFile } from "./api";
import type { Naming } from "./NameField";

export type FileMenuTarget = {
  /** What was right-clicked: a row, or the folder a pane is standing in. */
  path: string;
  name: string;
  /** True when the target is a folder, which is offered less than a file is.
   *  Copying one and renaming one are refused by the layer underneath, so they
   *  are not offered here either. Removing one is its own operation, and is
   *  offered — see `deleteFolder`, which is what says how much it takes. */
  isDir: boolean;
  /** Where a new file or folder is made — inside the folder that was
   *  right-clicked, or beside the file, in the directory listing it. This is
   *  also the folder whose rows a name is typed among. */
  into: string;
  /** The pane's own folder, which relative paths are measured from. */
  root: string;
  /** Which pane the row is drawn in. Two panes can be showing one folder, and
   *  a name typed in answer to this menu is typed in one of the two. */
  pane: number;
  at: { x: number; y: number };
};

type Props = {
  target: FileMenuTarget | null;
  /**
   * Starts a name being typed among the rows, rather than in a box over them.
   *
   * The menu is where it is asked for and not where it is answered: the answer
   * is a row's name, the place to type a row's name is the row, and the column
   * is what holds it — see `Naming`.
   */
  onName: (kind: Naming["kind"]) => void;
  onClose: () => void;
};

/** The operations offered by a row — or by the folder a pane is showing — at
 *  the point it was right-clicked. */
export function FileContextMenu({ target, onName, onClose }: Props) {
  const { t } = useTranslation();
  /** The one thing here that is still asked in a box over the window: what a
   *  removal takes away cannot be undone, and is not visible from the row. */
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  /** Where a download put its copy, which is the one answer worth reading. */
  const [went, setWent] = useState<string | null>(null);

  // Nothing from one file's menu belongs to the next one opened.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the target itself is the opening
  useEffect(() => {
    setDeleting(false);
    setBusy(null);
    setFailed(false);
    setWent(null);
  }, [target]);

  if (!target) return null;
  const { path, isDir, root } = target;
  /* The folder a pane is standing in is not offered for removal: the pane is
     standing in it, and what it would be left showing is a folder that is not
     there. It is a row in the pane above, where deleting it is deleting
     something you are looking at rather than something you are inside. */
  const removable = !isDir || path !== root;

  /**
   * One press, and what became of it.
   *
   * The menu shuts on its way out, because what was asked for has happened and
   * the row it happened to is behind it. `tell` is the exception: an operation
   * whose answer is worth reading keeps the menu open to say it, and is closed
   * by the person who read it.
   */
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
        {/* What is read out of the file: its contents, a copy of it, and the
            file itself. A folder is none of these — and each item stands on
            its own rather than in a fragment, which a menu cannot step
            through. */}
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
        {/* A folder comes down whole, so this is offered whatever was
            right-clicked. Where it lands is said rather than assumed: on a
            path inside a distribution the copy crosses to the machine the
            window is running on, which is not where the row is. */}
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
        {/* What is done to the entry itself. Renaming is a file's alone — the
            layer refuses to rename a folder, and an item that always fails is
            worse than no item. Removing is offered on both, and what the two
            take away is said in the asking rather than here. */}
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
              secondary={failed ? t("file.failed") : t("file.downloaded", { path: went })}
              slotProps={{ secondary: { sx: { wordBreak: "break-all" } } }}
            />
          </MenuItem>
        )}
      </Menu>

      <Dialog open={deleting} onClose={busy ? undefined : () => setDeleting(false)}>
        <DialogTitle>{t("file.deleteTitle", { name: target.name })}</DialogTitle>
        <DialogContent>
          {/* A folder takes everything under it with it, which is the whole of
              what somebody is agreeing to here and is not visible from the row
              they pressed. So the two are asked differently. */}
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

/** A path as it stands under the pane root, with separators left native. */
export function relativePath(root: string, path: string): string {
  const bare = root.replace(/[\\/]+$/, "");
  if (path === bare) return path.split(/[\\/]/).at(-1) ?? path;
  if (path.startsWith(`${bare}/`) || path.startsWith(`${bare}\\`)) {
    return path.slice(bare.length + 1);
  }
  return path;
}

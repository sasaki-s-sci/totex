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
  TextField,
} from "@mui/material";
import { type ReactNode, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { createEntry, deleteFile, duplicateFile, type FsEntry, readFile, renameFile } from "./api";

export type FileMenuTarget = {
  entry: FsEntry;
  /** The directory whose listing carries the file. */
  parent: string;
  /** The pane's own folder, which relative paths are measured from. */
  root: string;
  at: { x: number; y: number };
};

type DialogMode = "new-file" | "new-folder" | "rename" | "delete";

type Props = {
  target: FileMenuTarget | null;
  onClose: () => void;
};

/** The operations offered by a file row at the point it was right-clicked. */
export function FileContextMenu({ target, onClose }: Props) {
  const { t } = useTranslation();
  const [dialog, setDialog] = useState<DialogMode | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // Nothing from one file's menu belongs to the next one opened.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the target itself is the opening
  useEffect(() => {
    setDialog(null);
    setName("");
    setBusy(null);
    setFailed(false);
  }, [target]);

  if (!target) return null;
  const { entry, parent, root } = target;

  const openName = (mode: Exclude<DialogMode, "delete">) => {
    setFailed(false);
    setName(mode === "rename" ? entry.name : mode === "new-folder" ? t("file.newFolderName") : "");
    setDialog(mode);
  };

  const run = async (label: string, action: () => Promise<unknown>) => {
    setBusy(label);
    setFailed(false);
    try {
      await action();
      onClose();
    } catch {
      setFailed(true);
      setBusy(null);
    }
  };

  const naming = dialog !== null && dialog !== "delete";
  const wanted = name.trim();

  return (
    <>
      <Menu
        open={dialog === null}
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
          onClick={() => openName("new-file")}
        />
        <FileItem
          icon={<FolderOutlinedIcon />}
          label={t("file.newFolder")}
          disabled={busy !== null}
          onClick={() => openName("new-folder")}
        />
        <Divider />
        <FileItem
          icon={<ContentCopyIcon />}
          label={t("file.copy")}
          disabled={busy !== null}
          onClick={() => void run("copy", () => copyContents(entry.path))}
        />
        <FileItem
          icon={<FileCopyOutlinedIcon />}
          label={t("file.duplicate")}
          disabled={busy !== null}
          onClick={() => void run("duplicate", () => duplicateFile(entry.path))}
        />
        <FileItem
          icon={<DownloadOutlinedIcon />}
          label={t("file.download")}
          disabled={busy !== null}
          onClick={() => void run("download", () => download(entry.path, entry.name))}
        />
        <Divider />
        <FileItem
          icon={<RouteOutlinedIcon />}
          label={t("file.copyPath")}
          disabled={busy !== null}
          onClick={() => void run("copy-path", () => copyText(entry.path))}
        />
        <FileItem
          icon={<RouteOutlinedIcon />}
          label={t("file.copyRelativePath")}
          disabled={busy !== null}
          onClick={() =>
            void run("copy-relative-path", () => copyText(relativePath(root, entry.path)))
          }
        />
        <Divider />
        <FileItem
          icon={<DriveFileRenameOutlineIcon />}
          label={t("file.rename")}
          disabled={busy !== null}
          onClick={() => openName("rename")}
        />
        <FileItem
          icon={<DeleteOutlinedIcon />}
          label={t("file.delete")}
          disabled={busy !== null}
          colour="error.main"
          onClick={() => {
            setFailed(false);
            setDialog("delete");
          }}
        />
        {failed && (
          <MenuItem disabled>
            <ListItemText secondary={t("file.failed")} />
          </MenuItem>
        )}
      </Menu>

      <Dialog
        open={naming}
        onClose={busy ? undefined : () => setDialog(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{dialog && t(`file.${dialog}`)}</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            fullWidth
            size="small"
            value={name}
            error={failed}
            helperText={failed ? t("file.failed") : " "}
            slotProps={{ htmlInput: { spellCheck: false } }}
            onFocus={(event) => event.currentTarget.select()}
            onChange={(event) => {
              setName(event.currentTarget.value);
              setFailed(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && wanted && !busy) void submitName();
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button disabled={busy !== null} onClick={() => setDialog(null)}>
            {t("file.cancel")}
          </Button>
          <Button disabled={!wanted || busy !== null} onClick={() => void submitName()}>
            {t("file.confirm")}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={dialog === "delete"} onClose={busy ? undefined : () => setDialog(null)}>
        <DialogTitle>{t("file.deleteTitle", { name: entry.name })}</DialogTitle>
        <DialogContent>
          <DialogContentText>{t("file.deleteBody")}</DialogContentText>
          {failed && <DialogContentText color="error">{t("file.failed")}</DialogContentText>}
        </DialogContent>
        <DialogActions>
          <Button disabled={busy !== null} onClick={() => setDialog(null)}>
            {t("file.cancel")}
          </Button>
          <Button
            color="error"
            disabled={busy !== null}
            onClick={() => void run("delete", () => deleteFile(entry.path))}
          >
            {t("file.delete")}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );

  async function submitName() {
    if (!dialog || dialog === "delete" || !wanted) return;
    await run(dialog, () =>
      dialog === "rename"
        ? renameFile(entry.path, wanted)
        : createEntry(parent, wanted, dialog === "new-folder"),
    );
  }
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

async function download(path: string, name: string) {
  const bytes = new Uint8Array(await readFile(path));
  const url = URL.createObjectURL(new Blob([bytes.buffer]));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.style.display = "none";
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
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

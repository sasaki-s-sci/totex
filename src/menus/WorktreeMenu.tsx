import DeleteIcon from "@mui/icons-material/DeleteOutlined";
import { Button, CircularProgress, Dialog, Popover, Stack, Typography } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { BranchPick } from "../canvas/graphActions";
import { type Session, shellSession } from "../lib/session";
import { deleteBranch, dirtyCount, openWorkspace } from "../lib/workspace";
import { CliMark } from "../marks";
import { Palette, PaletteButton, PaletteDivider } from "./palette";
import { useMenuAction } from "./useMenuAction";

export type WorktreeTarget = BranchPick;

type Props = {
  target: WorktreeTarget | null;
  onClose: () => void;
  onOpen: (session: Session) => void;
  onEndAttached: (cwd: string) => Promise<void>;
};

function DeleteDialog({
  target,
  busy,
  failed,
  onCancel,
  onConfirm,
}: {
  target: WorktreeTarget | null;
  busy: boolean;
  failed: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  // Kept for the fade-out after the target is gone.
  const asked = useRef<WorktreeTarget | null>(null);
  if (target) asked.current = target;
  const shown = target ?? asked.current;
  if (!shown) return null;

  const files = shown.status ? dirtyCount(shown.status) : 0;

  return (
    <Dialog
      open={target !== null}
      onClose={busy ? undefined : onCancel}
      slotProps={{ paper: { sx: { width: 400 } } }}
    >
      <Stack sx={{ p: 2, gap: 1.5 }}>
        <Typography variant="subtitle2">
          {t("worktree.deleteTitle", { branch: shown.branch })}
        </Typography>
        <Stack sx={{ gap: 0.5 }}>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {t("worktree.deleteBranchLine")}
          </Typography>
          {shown.cwd && (
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              {t("worktree.deleteWorktreeLine")}
            </Typography>
          )}
          {files > 0 && (
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              {t("worktree.deleteDirtyLine", { count: files })}
            </Typography>
          )}
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            {t("worktree.deleteRemoteLine")}
          </Typography>
        </Stack>
        {/* Cancel takes focus so a stray Return keeps the branch. */}
        <Stack direction="row" sx={{ gap: 1, justifyContent: "flex-end", pt: 0.5 }}>
          <Button
            size="small"
            variant="outlined"
            color="inherit"
            autoFocus
            disabled={busy}
            onClick={onCancel}
            sx={{ color: "text.secondary" }}
          >
            {t("worktree.deleteCancel")}
          </Button>
          <Button
            size="small"
            variant="outlined"
            color="error"
            disabled={busy}
            startIcon={busy ? <CircularProgress size={14} color="inherit" /> : undefined}
            onClick={onConfirm}
          >
            {t(failed ? "worktree.deleteFailed" : "worktree.deleteConfirm")}
          </Button>
        </Stack>
      </Stack>
    </Dialog>
  );
}

export function WorktreeMenu({ target, onClose, onOpen, onEndAttached }: Props) {
  const { t } = useTranslation();
  // Outlives the menu: the question is answered after the popover is gone.
  const [asking, setAsking] = useState<WorktreeTarget | null>(null);
  const { busy, failed, run, reset } = useMenuAction(() => {
    setAsking(null);
    onClose();
  });

  const cwd = target?.cwd ?? null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: opening is the trigger
  useEffect(() => {
    reset();
  }, [target]);

  return (
    <>
      {target && (
        <Popover
          open
          onClose={busy ? undefined : onClose}
          anchorReference="anchorPosition"
          anchorPosition={{ top: target.at.y, left: target.at.x }}
          transformOrigin={{ vertical: "top", horizontal: "left" }}
        >
          <Palette>
            <PaletteButton
              label={t("worktree.terminal")}
              busy={busy === "open"}
              failed={failed === "open"}
              disabled={target.kind === "remote" || busy !== null}
              onClick={() =>
                void run("open", async () => {
                  const workspace = cwd
                    ? { path: cwd, branch: target.branch }
                    : await openWorkspace(target.repository.id, target.branch);
                  onOpen(shellSession(workspace.path, workspace.branch));
                })
              }
            >
              <CliMark size={20} />
            </PaletteButton>
            <PaletteDivider />
            <PaletteButton
              label={t("worktree.deleteBranch")}
              disabled={target.kind !== "local" || busy !== null}
              onClick={() => {
                setAsking(target);
                onClose();
              }}
            >
              <DeleteIcon fontSize="small" />
            </PaletteButton>
          </Palette>
        </Popover>
      )}

      <DeleteDialog
        target={asking}
        busy={busy === "delete"}
        failed={failed === "delete"}
        onCancel={() => {
          setAsking(null);
          reset();
        }}
        onConfirm={() => {
          if (!asking) return;
          void run("delete", async () => {
            if (asking.cwd) await onEndAttached(asking.cwd);
            return deleteBranch(asking.repository.id, asking.branch);
          });
        }}
      />
    </>
  );
}

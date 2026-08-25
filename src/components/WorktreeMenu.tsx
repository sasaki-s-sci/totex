import DeleteIcon from "@mui/icons-material/DeleteOutlined";
import { Button, CircularProgress, Dialog, Popover, Stack, Typography } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { RefKind } from "../lib/graph";
import { type Session, shellSession } from "../lib/session";
import { deleteBranch, dirtyCount, openWorkspace, type WorktreeStatus } from "../lib/workspace";
import type { Repository } from "../types/git";
import { CliMark } from "./marks";
import { Palette, PaletteButton, PaletteDivider } from "./palette";
import { useMenuAction } from "./useMenuAction";

/** The branch head a menu was opened on. */
export type WorktreeTarget = {
  repository: Repository;
  branch: string;
  kind: RefKind;
  /** Where it is checked out, or null when it has no worktree yet. */
  cwd: string | null;
  /**
   * What was uncommitted in there when the head was pressed. Undefined for a
   * branch with no worktree, and for one git has not answered for yet.
   */
  status?: WorktreeStatus;
  at: { x: number; y: number };
};

type Props = {
  target: WorktreeTarget | null;
  onClose: () => void;
  onOpen: (session: Session) => void;
  /** Ends everything running in a directory, so that it can be removed. */
  onEndAttached: (cwd: string) => Promise<void>;
};

/**
 * The question a deletion is put behind, and the one place in this window that
 * answers in sentences.
 *
 * Everywhere else a press that ends something is armed by a first press and run
 * by a second. That was enough while git itself refused an unmerged branch and
 * a dirty worktree; those presses reach git now, and what is behind them is
 * somebody's afternoon.
 *
 * It names what it can count and only what it has: a list padded with lines
 * saying nothing happens is a list nobody reads to the end of. The count is the
 * head's own, read for the ring long before this was opened. The confirming
 * press is red at rest, so a refusal is said by changing a word.
 */
function DeleteDialog({
  target,
  busy,
  failed,
  onCancel,
  onConfirm,
}: {
  /** The branch being asked about, or null once it has been answered. */
  target: WorktreeTarget | null;
  busy: boolean;
  /** Git refused it after all, which here is the main worktree's own branch. */
  failed: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  // The dialog fades on its way out, so it has to keep its words for as long as
  // that takes: what is drawn is the last branch asked about rather than the one
  // being asked about now, which is already gone by then.
  const asked = useRef<WorktreeTarget | null>(null);
  if (target) asked.current = target;
  const shown = target ?? asked.current;
  if (!shown) return null;

  const files = shown.status ? dirtyCount(shown.status) : 0;

  return (
    <Dialog
      open={target !== null}
      // Nothing takes the question away while its answer is running.
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

        {/* Keeping it is the near press and the one focus opens on: the answer
            somebody arrives at this box already meaning to give is the one that
            costs nothing, and it is the answer a stray return key gives. */}
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

/**
 * What can be done with a branch, as two marks.
 *
 * The state of the directory is neither written nor read here: the ring the menu
 * was opened from is already drawn from it, and what the head had in hand came
 * along with the press.
 *
 * Removal takes the branch and everything standing on it — its linked worktree,
 * and whatever was left uncommitted. A branch nothing has merged goes the same
 * way; its remote-tracking branch is left alone. That is a great deal to do to
 * somebody who meant the mark beside it, so the press puts the question instead
 * and the menu goes as the question arrives. The one branch that cannot go is
 * the one checked out in the repository's own directory.
 */
export function WorktreeMenu({ target, onClose, onOpen, onEndAttached }: Props) {
  const { t } = useTranslation();
  /**
   * The branch a press has asked about, held here rather than read off the
   * menu's own target: the menu is gone by the time the question is answered,
   * and the question has to outlive it.
   */
  const [asking, setAsking] = useState<WorktreeTarget | null>(null);
  const { busy, failed, run, reset } = useMenuAction(() => {
    setAsking(null);
    onClose();
  });

  const cwd = target?.cwd ?? null;

  // A menu as it opened, per opening: a refusal left over from the last one
  // belongs to a branch that is no longer the one being looked at.
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
              // A remote branch is somewhere else, and nothing here reaches it.
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
        // Turned down, and put back as it was: the red the box would come back
        // wearing belongs to the press that was refused, not to the next one.
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

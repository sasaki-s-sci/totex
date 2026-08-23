import DeleteIcon from "@mui/icons-material/DeleteOutlined";
import { Popover } from "@mui/material";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { RefKind } from "../lib/graph";
import { type Session, shellSession } from "../lib/session";
import {
  deleteBranch,
  dirtyCount,
  openWorkspace,
  type WorktreeStatus,
  workspaceStatus,
} from "../lib/workspace";
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
 * What can be done with a branch, as two marks.
 *
 * The state of the directory is not written here — the ring the menu was opened
 * from is already drawn from it, and saying it again in words was the same fact
 * twice. It is read all the same, because it decides what is offered: a
 * branch with uncommitted work in its worktree cannot be deleted, so the mark
 * for that is faded until it can.
 *
 * Removal is two presses. The first arms it and turns it red, the second ends
 * whatever this window is running in there, removes its linked worktree, and
 * deletes only the local branch. Its remote-tracking branch is left alone.
 */
export function WorktreeMenu({ target, onClose, onOpen, onEndAttached }: Props) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<WorktreeStatus | null>(null);
  const { busy, failed, confirming, setConfirming, run, reset } = useMenuAction(onClose);

  const cwd = target?.cwd ?? null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the worktree is the trigger
  useEffect(() => {
    setStatus(null);
    reset();
    if (!cwd) return;

    let live = true;
    workspaceStatus(cwd)
      .then((next) => {
        if (live) setStatus(next);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [cwd]);

  if (!target) return null;
  const { repository, branch, kind } = target;
  // Not yet read is not the same as clean: removal is the one thing here that
  // cannot be undone, so it waits for an answer rather than assuming one.
  const deletable =
    kind === "local" && (cwd === null || (status !== null && dirtyCount(status) === 0));

  return (
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
          disabled={kind === "remote" || busy !== null}
          onClick={() =>
            void run("open", async () => {
              const workspace = cwd
                ? { path: cwd, branch }
                : await openWorkspace(repository.id, branch);
              onOpen(shellSession(workspace.path, workspace.branch));
            })
          }
        >
          <CliMark size={20} />
        </PaletteButton>

        <PaletteDivider />

        <PaletteButton
          label={t("worktree.deleteBranch")}
          disabled={!deletable || busy !== null}
          busy={busy === "delete"}
          failed={failed === "delete"}
          danger={confirming}
          onClick={() => {
            if (!confirming) {
              setConfirming(true);
              return;
            }
            void run("delete", async () => {
              if (cwd) await onEndAttached(cwd);
              return deleteBranch(repository.id, branch);
            });
          }}
        >
          <DeleteIcon fontSize="small" />
        </PaletteButton>
      </Palette>
    </Popover>
  );
}

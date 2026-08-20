import AltRouteIcon from "@mui/icons-material/AltRoute";
import CheckIcon from "@mui/icons-material/Check";
import { Popover, Stack, TextField } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  branchTaken,
  createWorkspace,
  DRAFT_PREFIX,
  draftBranchName,
  isBranchName,
} from "../lib/workspace";
import type { Commit, Repository } from "../types/git";
import { Palette, PaletteButton } from "./palette";
import { useMenuAction } from "./useMenuAction";

/** What a commit was clicked for, and where the menu should open. */
export type CommitTarget = {
  repository: Repository;
  commit: Commit;
  at: { x: number; y: number };
};

type Props = {
  target: CommitTarget | null;
  onClose: () => void;
};

/**
 * What a commit is for: cutting a branch from it.
 *
 * One mark, and then a name — the only thing here that cannot be a mark, since
 * a branch has to be called something. The box is not empty when it opens: a
 * name is already in it, so the common case is two presses and nothing typed,
 * and the tick is out from the start because that name is one git would take
 * and this repository does not have. It is a suggestion and no more — the tail
 * comes up selected, so typing over it is the same one gesture as accepting it,
 * and the tick fades again the moment what is in the box could not be cut.
 *
 * The branch is made in its own worktree, so nothing here checks anything out.
 * What is left — a name git refuses after all — turns the tick red, and the
 * menu stays where it is.
 */
export function CommitMenu({ target, onClose }: Props) {
  const { t } = useTranslation();
  /** What the branch would be called, or null while the mark is still out. */
  const [name, setName] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const { busy, failed, run, reset } = useMenuAction(onClose);

  const naming = name !== null;

  // biome-ignore lint/correctness/useExhaustiveDependencies: opening is the trigger
  useEffect(() => {
    if (!target) return;
    setName(null);
    reset();
  }, [target?.commit.id]);

  // The prefix is the part worth keeping and the tail is the part worth
  // replacing, so the box opens with the caret already over the tail: one
  // keystroke either accepts the whole name or starts a different one.
  useEffect(() => {
    const node = field.current;
    if (!naming || !node) return;
    node.setSelectionRange(DRAFT_PREFIX.length, node.value.length);
  }, [naming]);

  if (!target) return null;
  const { repository, commit } = target;

  const wanted = (name ?? "").trim();
  const nameable = isBranchName(wanted) && !branchTaken(repository, wanted);

  return (
    <Popover
      open
      onClose={busy ? undefined : onClose}
      anchorReference="anchorPosition"
      anchorPosition={{ top: target.at.y, left: target.at.x }}
      transformOrigin={{ vertical: "top", horizontal: "left" }}
    >
      {name === null ? (
        <Palette>
          <PaletteButton label={t("commit.branch")} onClick={() => setName(draftBranchName())}>
            <AltRouteIcon fontSize="small" />
          </PaletteButton>
        </Palette>
      ) : (
        <Stack direction="row" spacing={0.5} sx={{ p: 0.75, alignItems: "center" }}>
          <TextField
            size="small"
            autoFocus
            inputRef={field}
            value={name}
            spellCheck={false}
            autoComplete="off"
            disabled={busy !== null}
            sx={{
              width: 232,
              // Nothing in this window turns blue to say it is being typed in;
              // the box is where the caret is, and the caret says so already.
              "& .MuiOutlinedInput-root": {
                "& fieldset": { borderColor: "divider", borderWidth: 1 },
                "&:hover fieldset": { borderColor: "divider" },
                "&.Mui-focused fieldset": { borderColor: "divider", borderWidth: 1 },
              },
            }}
            onChange={(event) => setName(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && nameable && !busy) void submit();
              if (event.key === "Escape" && !busy) setName(null);
            }}
          />
          <PaletteButton
            label={t("commit.create")}
            disabled={!nameable}
            busy={busy === "create"}
            failed={failed === "create"}
            onClick={() => void submit()}
          >
            <CheckIcon fontSize="small" />
          </PaletteButton>
        </Stack>
      )}
    </Popover>
  );

  async function submit() {
    await run("create", () => createWorkspace(repository.id, wanted, commit.id));
  }
}

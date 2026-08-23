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
import { PaletteButton } from "./palette";
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
 * A name, which is the only thing here that cannot be a mark, since a branch
 * has to be called something. The mark that used to stand in front of it is on
 * the canvas now, over the commit itself — being shown that a commit can be
 * branched and asking for one were the same press twice, and the one that is
 * left is the one that had something to say.
 *
 * The box is not empty when it opens: a name is already in it, so the common
 * case is one press and nothing typed, and the tick is out from the start
 * because that name is one git would take and this repository does not have. It
 * is a suggestion and no more — the tail comes up selected, so typing over it is
 * the same one gesture as accepting it, and the tick fades again the moment what
 * is in the box could not be cut.
 *
 * The branch is made in its own worktree, so nothing here checks anything out.
 * What is left — a name git refuses after all — turns the tick red, and the
 * menu stays where it is.
 */
export function CommitMenu({ target, onClose }: Props) {
  const { t } = useTranslation();
  /** What the branch would be called, or null before any box has been opened. */
  const [name, setName] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  /** The opening the caret has already been laid for, and not laid for twice. */
  const laid = useRef<CommitTarget | null>(null);
  const { busy, failed, run, reset } = useMenuAction(onClose);

  // A suggestion of its own per opening, and nothing left over from the last
  // one. Every press makes a target of its own, so the same commit asked twice
  // is two openings and two names.
  // biome-ignore lint/correctness/useExhaustiveDependencies: opening is the trigger
  useEffect(() => {
    if (!target) return;
    setName(draftBranchName());
    reset();
  }, [target]);

  // The prefix is the part worth keeping and the tail is the part worth
  // replacing, so the box opens with the caret already over the tail: one
  // keystroke either accepts the whole name or starts a different one. The name
  // arriving is what opening comes to here, and it is laid once for each — left
  // to run on every change it would select back over whatever had been typed.
  // biome-ignore lint/correctness/useExhaustiveDependencies: the name arriving is the box opening
  useEffect(() => {
    const node = field.current;
    if (!target || !node || laid.current === target) return;
    laid.current = target;
    node.setSelectionRange(DRAFT_PREFIX.length, node.value.length);
  }, [name]);

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
      <Stack direction="row" spacing={0.5} sx={{ p: 0.75, alignItems: "center" }}>
        <TextField
          size="small"
          autoFocus
          inputRef={field}
          value={name ?? ""}
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
    </Popover>
  );

  async function submit() {
    await run("create", () => createWorkspace(repository.id, wanted, commit.id));
  }
}

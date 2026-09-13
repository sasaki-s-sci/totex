import CheckIcon from "@mui/icons-material/Check";
import { Popover, Stack, TextField } from "@mui/material";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { type Session, shellSession } from "../lib/session";
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

export type CommitTarget = {
  repository: Repository;
  commit: Commit;
  at: { x: number; y: number };
};

type Props = {
  target: CommitTarget | null;
  onClose: () => void;
  onOpen: (session: Session) => void;
};

export function CommitMenu({ target, onClose, onOpen }: Props) {
  const { t } = useTranslation();
  const [name, setName] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const laid = useRef<CommitTarget | null>(null);
  const { busy, failed, run, reset } = useMenuAction(onClose);

  // biome-ignore lint/correctness/useExhaustiveDependencies: opening is the trigger
  useEffect(() => {
    if (!target) return;
    setName(draftBranchName());
    reset();
  }, [target]);

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
    const workspace = await run("create", () => createWorkspace(repository.id, wanted, commit.id));
    // After the popover closes: it restores focus on the way out, which would take it off a terminal opened first.
    if (workspace) onOpen(shellSession(workspace.path, workspace.branch));
  }
}

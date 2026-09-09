import { Box, Tooltip } from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { pollVisible } from "../lib/pollVisible";

type Identity = { author: string | null; committer: string | null };

export function CliIdentity({ cwd, shown }: { cwd: string; shown: boolean }) {
  const { t } = useTranslation();
  const [identity, setIdentity] = useState<Identity | null | undefined>();

  useEffect(() => {
    setIdentity(undefined);
    if (!shown) return;
    return pollVisible(
      () => invoke<Identity>("git_identity", { path: cwd }).catch(() => null),
      setIdentity,
      5000,
    );
  }, [cwd, shown]);

  const author = identity?.author ?? t("cli.identityUnset");
  const committer = identity?.committer ?? t("cli.identityUnset");
  const label =
    identity === undefined
      ? t("cli.identityLoading")
      : identity === null
        ? t("cli.identityUnavailable")
        : identity.author === identity.committer
          ? t("cli.identity", { identity: author })
          : t("cli.identityRoles", { author, committer });

  return (
    <Tooltip title={t("cli.identityHint", { path: cwd })}>
      <Box
        component="span"
        sx={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", lineHeight: "12px" }}
      >
        {label}
      </Box>
    </Tooltip>
  );
}

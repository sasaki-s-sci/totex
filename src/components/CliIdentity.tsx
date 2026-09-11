import { Tooltip } from "@mui/material";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { pollVisible } from "../lib/pollVisible";

type Identity = { author: string | null; committer: string | null };

/** The two halves of a `Name <mail>` ident, as git prints one. */
function split(ident: string): { name: string; mail: string } {
  const open = ident.lastIndexOf("<");
  if (open < 0) return { name: ident.trim(), mail: "" };
  return {
    name: ident.slice(0, open).trim(),
    mail: ident
      .slice(open + 1)
      .replace(/>\s*$/, "")
      .trim(),
  };
}

/** The git mark, drawn in the ink of the text beside it. */
function GitIcon() {
  return (
    <svg className="cli__identity-icon" viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M15.7 7.3 8.7.3a1 1 0 0 0-1.4 0L5.8 1.8l1.9 1.9a1.2 1.2 0 0 1 1.5 1.5l1.8 1.8a1.2 1.2 0 1 1-.7.7L8.6 6v4.4a1.2 1.2 0 1 1-1 0V6a1.2 1.2 0 0 1-.6-1.6L5.1 2.5.3 7.3a1 1 0 0 0 0 1.4l7 7a1 1 0 0 0 1.4 0l7-7a1 1 0 0 0 0-1.4"
      />
    </svg>
  );
}

/** One ident as two short lines: the name over the mail. */
function Ident({ ident }: { ident: string }) {
  const { name, mail } = split(ident);
  return (
    <span className="cli__identity-ident">
      <span className="cli__identity-name">{name}</span>
      {mail !== "" && <span className="cli__identity-mail">{mail}</span>}
    </span>
  );
}

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

  // Nothing read yet, or nothing to read: one line says so, in place of the two.
  const idents =
    identity === undefined
      ? null
      : identity === null
        ? null
        : identity.author === identity.committer
          ? [author]
          : [author, committer];

  return (
    <Tooltip title={t("cli.identityHint", { path: cwd })}>
      <span className="cli__identity">
        <GitIcon />
        {idents === null ? (
          <span className="cli__identity-name">{label}</span>
        ) : (
          idents.map((ident) => <Ident key={ident} ident={ident} />)
        )}
      </span>
    </Tooltip>
  );
}

// A spare is a whole checkout, so only a repository already worked in through worktrees is given
// one up front; any other gets its first on the way out of its first branch cut.

import { useEffect, useMemo } from "react";

import { useKeepingSpare } from "../lib/spare";
import { tendSpares } from "../lib/workspace";
import type { Repository } from "../types/git";

export function useSpares(repositories: readonly Repository[]) {
  const keeping = useKeepingSpare();

  // Keyed on the ids: a rescan hands back new objects several times a minute.
  const key = useMemo(
    () =>
      repositories
        // Switched off, every repository is asked: a spare is drawn nowhere, so which has one is not known here.
        .filter(
          (repository) => !keeping || repository.worktrees.some((worktree) => !worktree.isMain),
        )
        .map((repository) => repository.id)
        .join("\0"),
    [repositories, keeping],
  );

  useEffect(() => {
    if (key === "") return;
    tendSpares(key.split("\0"), keeping).catch(() => undefined);
  }, [key, keeping]);
}

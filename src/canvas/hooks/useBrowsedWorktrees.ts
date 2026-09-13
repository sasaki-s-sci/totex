import { useMemo } from "react";

import { type Browsing, browsedWorktrees, worktreePaths } from "../../lib/worktrees";
import type { Workspace } from "../../types/git";

export function useBrowsedWorktrees(
  workspace: Workspace | null,
  panes: readonly string[],
): Browsing {
  const worktrees = useMemo(() => worktreePaths(workspace), [workspace]);

  // One key for both lists, with a separator, so a path moving between them still counts as a change.
  const key = [...worktrees, "", ...panes].join("\n");

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is both lists
  return useMemo(() => browsedWorktrees(worktrees, panes), [key]);
}

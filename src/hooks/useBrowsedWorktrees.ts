import { useMemo } from "react";

import { type Browsing, browsedWorktrees, worktreePaths } from "../lib/worktrees";
import type { Workspace } from "../types/git";

/**
 * Which worktrees the folder column is standing in.
 *
 * Held by the paths themselves rather than by the objects they came out of: a
 * delta that moved a branch rebuilds the workspace and leaves every directory
 * where it was, and handing back a fresh answer for that would redraw every
 * ring on the canvas to say that nothing had changed.
 */
export function useBrowsedWorktrees(
  workspace: Workspace | null,
  panes: readonly string[],
): Browsing {
  const worktrees = useMemo(() => worktreePaths(workspace), [workspace]);
  // Both lists in one dependency, with an empty line between them so that a
  // path moving from one to the other is still a change.
  const key = [...worktrees, "", ...panes].join("\n");

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is both lists
  return useMemo(() => browsedWorktrees(worktrees, panes), [key]);
}

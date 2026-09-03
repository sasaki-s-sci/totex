/**
 * The directories a workspace's branches are checked out in, and which of them
 * the folder column is standing in.
 */

import type { Workspace } from "../types/git";

/** The worktrees the column has a pane inside, by their own directories. */
export type Browsing = ReadonlySet<string>;

/** Every directory worth asking about: a worktree that is there to be read. */
export function worktreePaths(workspace: Workspace | null): string[] {
  if (!workspace) return [];
  const paths: string[] = [];
  for (const repository of workspace.repositories) {
    for (const worktree of repository.worktrees) {
      if (worktree.exists && !worktree.bare) paths.push(worktree.path);
    }
  }
  return paths;
}

/**
 * Which worktrees the column's panes are standing in.
 *
 * A pane counts as being in a worktree while it is anywhere under it, not only
 * at its root: pressing a branch's ring puts the pane at the top of that copy,
 * and walking two folders into it has not left it. The pane is still reading
 * that codebase, so the ring that stands for it still says so.
 *
 * The longest directory that contains the pane wins, which is what keeps a
 * repository nested inside another from lighting both rings: the pane is in one
 * checkout, and it is the innermost one.
 */
export function browsedWorktrees(worktrees: readonly string[], panes: readonly string[]): Browsing {
  const standing = new Set<string>();
  for (const pane of panes) {
    let innermost: string | null = null;
    for (const worktree of worktrees) {
      if (!inside(worktree, pane)) continue;
      if (innermost === null || worktree.length > innermost.length) innermost = worktree;
    }
    if (innermost !== null) standing.add(innermost);
  }
  return standing;
}

/**
 * Whether `path` is `directory` or something under it.
 *
 * Both separators, because a path is spelled the way the machine that answered
 * for it spells it -- `C:\dir` and `\\wsl.localhost\Ubuntu\dir` reach this
 * window alongside `/dir`. Trailing separators are cut so that a root, which is
 * the one directory that ends in one, is compared like any other.
 */
function inside(directory: string, path: string): boolean {
  const held = directory.replace(/[\\/]+$/, "");
  const under = path.replace(/[\\/]+$/, "");
  if (under === held) return true;
  if (!under.startsWith(held)) return false;
  const next = under[held.length];
  return next === "/" || next === "\\";
}

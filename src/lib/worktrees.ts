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

/** Every worktree that is there, by the directory its repository keeps. */
export type Homes = ReadonlyMap<string, string>;

/**
 * Reads that off a workspace.
 *
 * The main worktree stands against itself: git refuses to remove it, so it is
 * the one copy of a repository still there after any of the others has been
 * taken away, and therefore where a pane left standing in one goes.
 *
 * A repository whose main worktree is not on the disk is left out whole. There
 * is nowhere to send anybody, and saying so by absence is what tells a worktree
 * that was deleted apart from a folder that was taken off the graph: the first
 * loses one entry, the second loses the repository's home along with it.
 */
export function worktreeHomes(workspace: Workspace | null): Homes {
  const homes = new Map<string, string>();
  if (!workspace) return homes;
  for (const repository of workspace.repositories) {
    const standing = repository.worktrees.filter((worktree) => worktree.exists && !worktree.bare);
    const home = standing.find((worktree) => worktree.isMain)?.path;
    if (home === undefined) continue;
    for (const worktree of standing) homes.set(worktree.path, home);
  }
  return homes;
}

/**
 * Where a pane goes when the worktree it was standing in is taken away, or null
 * while there is no reason to move it.
 *
 * Three things have to hold: the pane was inside a worktree, that worktree is
 * gone, and its repository is still one this window is reading. So a branch
 * deleted from the canvas moves the panes that were in that copy of that
 * repository, and nothing else in the column moves at all — a folder taken off
 * the graph takes its repository's home with it and is answered with null,
 * which leaves those panes where somebody put them.
 *
 * The innermost worktree wins, as it does in `browsedWorktrees`: a repository
 * nested inside another is the checkout the pane was actually in.
 */
export function homeAfterRemoval(before: Homes, after: Homes, pane: string): string | null {
  let innermost: string | null = null;
  let home: string | null = null;
  for (const [worktree, kept] of before) {
    if (after.has(worktree) || !after.has(kept)) continue;
    if (!inside(worktree, pane)) continue;
    if (innermost !== null && worktree.length <= innermost.length) continue;
    innermost = worktree;
    home = kept;
  }
  return home;
}

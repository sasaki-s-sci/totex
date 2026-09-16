import type { Workspace } from "../types/git";

export type Browsing = ReadonlySet<string>;

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

/** The innermost containing worktree wins, so a nested repository lights one ring. */
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

/** Both separators: a path is spelled the way the machine that answered for it spells it. */
function inside(directory: string, path: string): boolean {
  const held = directory.replace(/[\\/]+$/, "");
  const under = path.replace(/[\\/]+$/, "");
  if (under === held) return true;
  if (!under.startsWith(held)) return false;
  const next = under[held.length];
  return next === "/" || next === "\\";
}

/** The branch each standing worktree is on, by path; a detached one goes by the name git gave it. */
export function worktreeBranches(workspace: Workspace | null): ReadonlyMap<string, string> {
  const branches = new Map<string, string>();
  if (!workspace) return branches;
  for (const repository of workspace.repositories) {
    for (const worktree of repository.worktrees) {
      if (worktree.exists && !worktree.bare) {
        branches.set(worktree.path, worktree.branch ?? worktree.name);
      }
    }
  }
  return branches;
}

export type Homes = ReadonlyMap<string, string>;

/**
 * A repository whose main worktree is missing is left out whole; that absence is what tells a
 * deleted worktree from a folder taken off the graph.
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

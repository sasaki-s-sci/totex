import type { Repository } from "../types/git";
import type { Graphed } from "./graphed";
import type { Session } from "./session";

/** Compare whole path components, keeping Unix and SSH paths case-sensitive. */
export function underPlace(root: string, cwd: string): boolean {
  const windows = /^[a-z]:[\\/]/i.test(root) || root.startsWith("\\\\");
  const normalize = (path: string) => {
    const slashed = windows ? path.replaceAll("\\", "/").toLowerCase() : path;
    return slashed.replace(/\/+$/, "");
  };
  const parent = normalize(root);
  const path = normalize(cwd);
  return path === parent || path.startsWith(`${parent}/`);
}

/**
 * Worktrees can stand outside the repository folder; directory prefixes alone miss them.
 * `kept` are the roots that stay on the canvas: a session under one of them, and deeper than the
 * places being removed, belongs to that kept root and stays alive.
 */
export function sessionsInPlaces(
  places: readonly Graphed[],
  repositories: readonly Repository[],
  kept: readonly string[] = [],
): (session: Session) => boolean {
  const roots = new Set<string>();
  for (const place of places) {
    roots.add(place.root);
    for (const repository of repositories) {
      if (!underPlace(place.root, repository.path)) continue;
      for (const worktree of repository.worktrees) roots.add(worktree.path);
    }
  }
  for (const root of kept) roots.delete(root);
  const everything = [...roots, ...kept];
  return (session) => {
    const owner = everything
      .filter((root) => underPlace(root, session.cwd))
      .reduce((deepest, root) => (root.length > deepest.length ? root : deepest), "");
    return roots.has(owner);
  };
}

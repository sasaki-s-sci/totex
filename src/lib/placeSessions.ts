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

/** Worktrees can stand outside the repository folder; directory prefixes alone miss them. */
export function sessionsInPlaces(
  places: readonly Graphed[],
  repositories: readonly Repository[],
): (session: Session) => boolean {
  const roots = new Set<string>();
  for (const place of places) {
    roots.add(place.root);
    for (const repository of repositories) {
      if (!underPlace(place.root, repository.path)) continue;
      for (const worktree of repository.worktrees) roots.add(worktree.path);
    }
  }
  return (session) => !session.overseer && [...roots].some((root) => underPlace(root, session.cwd));
}

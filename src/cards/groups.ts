import { baseName } from "../folder/format";
import type { Folder } from "../hooks/useWorkspace";
import { underPlace } from "../lib/placeSessions";
import type { Session } from "../lib/session";
import type { Repository, Worktree } from "../types/git";

export type FolderCard = {
  path: string;
  name: string;
  repository: Repository | null;
  worktree: Worktree | null;
  sessions: Session[];
};

export type CardGroup = {
  repository: Repository | null;
  cards: FolderCard[];
};

export function cardGroups(
  repositories: readonly Repository[],
  folders: readonly Folder[],
  sessions: readonly Session[],
): CardGroup[] {
  const cards: FolderCard[] = [];
  const samePath = (a: string, b: string) => underPlace(a, b) && underPlace(b, a);
  const add = (path: string, repository: Repository | null, worktree: Worktree | null) => {
    const found = cards.find((card) => samePath(card.path, path));
    if (found) return found;
    const card = { path, name: baseName(path), repository, worktree, sessions: [] as Session[] };
    cards.push(card);
    return card;
  };
  for (const repository of repositories) {
    for (const worktree of repository.worktrees) {
      if (!worktree.bare && worktree.exists) add(worktree.path, repository, worktree);
    }
    if (!repository.bare && !repository.worktrees.length) add(repository.path, repository, null);
  }
  for (const folder of folders) {
    if (folder.kind === "folder") add(folder.root, null, null);
  }
  for (const session of sessions) {
    // The deepest worktree wins, including nested repositories and worktrees outside the main checkout.
    const worktree = cards
      .filter((card) => card.repository && underPlace(card.path, session.cwd))
      .sort((a, b) => b.path.length - a.path.length)[0];
    const card = worktree ?? add(session.cwd, null, null);
    card.sessions.push(session);
  }
  const groups: CardGroup[] = repositories.map((repository) => ({
    repository,
    cards: cards.filter((card) => card.repository?.id === repository.id),
  }));
  const plain = cards.filter((card) => !card.repository);
  if (plain.length) groups.push({ repository: null, cards: plain });
  return groups;
}

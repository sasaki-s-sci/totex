import { baseName, folderOf } from "../folder/format";
import type { Folder } from "../hooks/useWorkspace";
import type { AppNode } from "../lib/graph";
import { underPlace } from "../lib/placeSessions";
import type { Session } from "../lib/session";
import type { Repository, Worktree } from "../types/git";

export type FolderCard = {
  path: string;
  name: string;
  repository: Repository | null;
  worktree: Worktree | null;
  sessions: Session[];
  files: AppNode[];
};

export type CardGroup = {
  repository: Repository | null;
  cards: FolderCard[];
};

export function cardGroups(
  repositories: readonly Repository[],
  folders: readonly Folder[],
  sessions: readonly Session[],
  files: readonly AppNode[] = [],
): CardGroup[] {
  const cards: FolderCard[] = [];
  const samePath = (a: string, b: string) => underPlace(a, b) && underPlace(b, a);
  const add = (path: string, repository: Repository | null, worktree: Worktree | null) => {
    const found = cards.find((card) => samePath(card.path, path));
    if (found) return found;
    const card = {
      path,
      name: baseName(path),
      repository,
      worktree,
      sessions: [] as Session[],
      files: [] as AppNode[],
    };
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
  for (const file of files) {
    if (file.data.view === "settings") continue;
    const root = file.data.folder;
    const owner = cards
      .filter((card) => (root ? samePath(card.path, root) : underPlace(card.path, file.data.path)))
      .sort((a, b) => b.path.length - a.path.length)[0];
    (owner ?? add(root ?? folderOf(file.data.path) ?? file.data.path, null, null)).files.push(file);
  }
  const groups: CardGroup[] = repositories.map((repository) => ({
    repository,
    cards: cards.filter((card) => card.repository?.id === repository.id),
  }));
  const plain = cards.filter((card) => !card.repository);
  if (plain.length) groups.push({ repository: null, cards: plain });
  return groups;
}

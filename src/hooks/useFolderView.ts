import { useCallback, useRef, useState } from "react";

import { isOpen } from "../lib/graph/folders";
import type { Folder } from "./useWorkspace";

/**
 * Which repositories are opened out into a band, and which are one mark on
 * their folder's row.
 *
 * Only what was actually asked for is held: a repository nobody has pressed is
 * not in here at all, and what it does then is `isOpen`'s answer — a folder of
 * one opens it, a folder of several folds it. So a repository arriving in a
 * folder behaves like the ones beside it rather than like the last thing that
 * was pressed somewhere else.
 */
export function useFolderView(folders: readonly Folder[]) {
  const [opened, setOpened] = useState<ReadonlyMap<string, boolean>>(() => new Map());
  // The folders as they are now, for the one action that needs to know what is
  // in a folder. Read through a ref so that pressing a name does not have to
  // rebuild every mark on the canvas first.
  const held = useRef(folders);
  held.current = folders;

  const set = useCallback((repositories: readonly string[], open: boolean) => {
    setOpened((current) => {
      // The same answer is not a change, and the graph is rebuilt from this.
      if (repositories.every((id) => current.get(id) === open)) return current;
      const next = new Map(current);
      for (const id of repositories) next.set(id, open);
      return next;
    });
  }, []);

  const openRepository = useCallback((repository: string) => set([repository], true), [set]);
  const foldRepository = useCallback((repository: string) => set([repository], false), [set]);

  /**
   * The folder's name: opens the lot, or folds the lot away.
   *
   * Folding wins only when there is nothing left to open — a folder with one
   * band showing and five marks beside it is a folder somebody is part way
   * through opening, and the press they make next is the rest of it.
   */
  const toggleFolder = useCallback((root: string) => {
    const folder = held.current.find((candidate) => candidate.root === root);
    if (!folder) return;

    setOpened((current) => {
      const count = folder.repositories.length;
      const all = folder.repositories.every((id) => isOpen(current, id, count));
      const next = new Map(current);
      for (const id of folder.repositories) next.set(id, !all);
      return next;
    });
  }, []);

  return { opened, openRepository, foldRepository, toggleFolder };
}

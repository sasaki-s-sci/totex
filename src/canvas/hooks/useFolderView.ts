import { useCallback, useRef, useState } from "react";
import type { Folder } from "../../hooks/useWorkspace";
import { isOpen } from "../../lib/graph/folders";

export function useFolderView(folders: readonly Folder[]) {
  const [opened, setOpened] = useState<ReadonlyMap<string, boolean>>(() => new Map());

  // Ref so that pressing a name does not rebuild every mark first.
  const held = useRef(folders);
  held.current = folders;

  const set = useCallback((repositories: readonly string[], open: boolean) => {
    setOpened((current) => {
      if (repositories.every((id) => current.get(id) === open)) return current;
      const next = new Map(current);
      for (const id of repositories) next.set(id, open);
      return next;
    });
  }, []);

  const openRepository = useCallback((repository: string) => set([repository], true), [set]);
  const foldRepository = useCallback((repository: string) => set([repository], false), [set]);

  // Folding wins only when nothing is left to open.
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

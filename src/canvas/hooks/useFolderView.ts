import { useCallback, useState } from "react";

export function useFolderView() {
  const [opened, setOpened] = useState<ReadonlyMap<string, boolean>>(() => new Map());

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

  return { opened, openRepository, foldRepository };
}

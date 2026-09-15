import { useCallback, useEffect, useMemo, useRef } from "react";
import type { Folder } from "../hooks/useWorkspace";
import { useFrontState } from "../shell/state";
import type { Repository, Workspace } from "../types/git";

/**
 * Closing is about the canvas only; a repository no longer scanned is forgotten, so re-graphing its
 * folder brings it back.
 */
export function useClosedRepositories(workspace: Workspace | null, folders: readonly Folder[]) {
  const [closed, setClosed] = useFrontState<ReadonlySet<string>>("window.closed", () => new Set());

  const closeRepository = useCallback((repository: Repository) => {
    setClosed((current) => new Set(current).add(repository.id));
  }, []);

  // Ref so that pressing a folder's name does not hand every node a fresh callback.
  const held = useRef(folders);
  held.current = folders;

  /** Every repository the folder holds leaves the canvas; the folder's row stays. */
  const closeFolder = useCallback((root: string) => {
    const folder = held.current.find((candidate) => candidate.root === root);
    if (!folder || folder.repositories.length === 0) return;
    setClosed((current) => {
      if (folder.repositories.every((id) => current.has(id))) return current;
      const next = new Set(current);
      for (const id of folder.repositories) next.add(id);
      return next;
    });
  }, []);

  useEffect(() => {
    setClosed((current) => {
      if (current.size === 0) return current;
      const scanned = new Set(workspace?.repositories.map((repository) => repository.id));
      const kept = [...current].filter((id) => scanned.has(id));
      return kept.length === current.size ? current : new Set(kept);
    });
  }, [workspace]);

  const drawn = useMemo(() => {
    if (!workspace || closed.size === 0) return workspace;
    return {
      ...workspace,
      repositories: workspace.repositories.filter((repository) => !closed.has(repository.id)),
    };
  }, [workspace, closed]);

  return { drawn, closeRepository, closeFolder };
}

import { useCallback, useEffect, useMemo } from "react";
import { useFrontState } from "../shell/state";
import type { Repository, Workspace } from "../types/git";

/**
 * Repositories taken off the canvas by the mark beside their name. Closing is
 * about the canvas only: the folder stays watched and its sessions carry on.
 * A repository no longer scanned is forgotten rather than kept closed, so
 * re-graphing its folder brings it back.
 */
export function useClosedRepositories(workspace: Workspace | null) {
  const [closed, setClosed] = useFrontState<ReadonlySet<string>>("window.closed", () => new Set());

  const closeRepository = useCallback((repository: Repository) => {
    setClosed((current) => new Set(current).add(repository.id));
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

  return { drawn, closeRepository };
}

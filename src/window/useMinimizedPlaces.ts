import { useCallback, useMemo } from "react";
import { baseName } from "../folder/format";
import type { Folder } from "../hooks/useWorkspace";
import { type Graphed, graphedKey } from "../lib/graphed";
import { useFrontState } from "../shell/state";
import type { Repository, Workspace } from "../types/git";

export type MinimizedPlace = Graphed & { name: string };

/** Minimized places remain scanned and keep their terminals; only their canvas rows are hidden. */
export function useMinimizedPlaces(
  workspace: Workspace | null,
  folders: readonly Folder[],
  minimizedPanes: readonly Graphed[],
) {
  const [minimized, setMinimized] = useFrontState<readonly MinimizedPlace[]>(
    "window.minimizedPlaces.v1",
    [],
  );
  const putAway = useCallback((place: MinimizedPlace) => {
    setMinimized((current) =>
      current.some((held) => graphedKey(held) === graphedKey(place))
        ? current
        : [...current, place],
    );
  }, []);
  const restore = useCallback((place: Graphed) => {
    setMinimized((current) => current.filter((held) => graphedKey(held) !== graphedKey(place)));
  }, []);
  const repositoryPlace = useCallback(
    (repository: Repository): MinimizedPlace => ({
      kind: "repository",
      root:
        folders.find((folder) => folder.repositories.includes(repository.id))?.root ??
        repository.path,
      name: repository.name,
    }),
    [folders],
  );
  const minimizeRepository = useCallback(
    (repository: Repository) => putAway(repositoryPlace(repository)),
    [repositoryPlace, putAway],
  );
  const minimizeFolder = useCallback(
    (root: string) => putAway({ kind: "folder", root, name: baseName(root) }),
    [putAway],
  );
  const hidden = useMemo(
    () => new Set([...minimized, ...minimizedPanes].map(graphedKey)),
    [minimized, minimizedPanes],
  );
  const drawnFolders = useMemo(
    () => folders.filter((folder) => !hidden.has(graphedKey(folder))),
    [folders, hidden],
  );
  const drawn = useMemo(() => {
    if (!workspace || hidden.size === 0) return workspace;
    const suppressed = new Set(
      folders
        .filter((folder) => hidden.has(graphedKey(folder)))
        .flatMap((folder) => folder.repositories),
    );
    return {
      ...workspace,
      repositories: workspace.repositories.filter((repository) => !suppressed.has(repository.id)),
    };
  }, [workspace, folders, hidden]);
  return {
    minimized,
    restore,
    repositoryPlace,
    minimizeRepository,
    minimizeFolder,
    drawn,
    drawnFolders,
  };
}

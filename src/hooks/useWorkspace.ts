import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";

import { baseName } from "../folder/format";
import { type Graphed, type GraphedKind, graphedKey } from "../lib/graphed";
import { applyWorkspaceDelta } from "../lib/workspaceDelta";
import { readyAfter, retiring } from "../shell/bridge";
import { useFrontState } from "../shell/state";
import type { Repository, Workspace, WorkspaceDelta } from "../types/git";

const DELTA_EVENT = "workspace:delta";
const FAILED_EVENT = "workspace:failed";

// No path on any platform contains NUL, which keeps the join reversible.
const SEPARATOR = "\u0000";

type Open = Record<string, Workspace>;

/** One group on the canvas: a folder as a folder holds no repository; a repository holds itself. */
export type Folder = {
  kind: GraphedKind;
  root: string;
  name: string;
  repositories: string[];
};

/**
 * Only the repositories are scanned, each on its own: a folder graphed as a folder is drawn from
 * its path alone.
 */
export function useWorkspaces(roots: readonly Graphed[]) {
  const [open, setOpen] = useFrontState<Open>("workspace.open", {});
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  const held = useRef(new Set<string>());
  // Registered once, so it reads through a ref.
  const current = useRef<Open>(open);
  useEffect(() => {
    current.current = open;
  }, [open]);

  const key = roots
    .filter((graphed) => graphed.kind === "repository")
    .map((graphed) => graphed.root)
    .join(SEPARATOR);
  const every = roots.map(graphedKey).join(SEPARATOR);

  useEffect(() => {
    const wanted = key ? key.split(SEPARATOR) : [];

    for (const root of [...held.current]) {
      if (wanted.includes(root)) continue;
      held.current.delete(root);
      setOpen((previous) => {
        const next = { ...previous };
        delete next[root];
        return next;
      });
      void invoke("close_workspace", { root }).catch(() => undefined);
    }

    const fresh = wanted.filter((root) => !held.current.has(root));
    if (fresh.length === 0) return;
    for (const root of fresh) held.current.add(root);

    setLoading(true);
    setFailed(false);
    void readyAfter(
      Promise.all(
        fresh.map((root) =>
          invoke<Workspace>("scan_workspace", { root, repository: true })
            .then((workspace) => {
              if (held.current.has(root))
                setOpen((previous) => ({ ...previous, [root]: workspace }));
            })
            .catch(() => {
              held.current.delete(root);
              setFailed(true);
            }),
        ),
      ),
    ).finally(() => setLoading(false));
  }, [key]);

  useEffect(() => {
    const pending = Promise.all([
      listen<WorkspaceDelta>(DELTA_EVENT, (event) => {
        // Deltas name the root the scan settled on (`~`, `..`, links resolved), not the path asked
        // for.
        const entry = Object.entries(current.current).find(
          ([, workspace]) => workspace.root === event.payload.root,
        );
        if (!entry) return;
        const [root] = entry;

        // A landing commit is not a user action: it waits behind input.
        startTransition(() => {
          setOpen((previous) => {
            const showing = previous[root];
            if (!showing) return previous;
            return { ...previous, [root]: applyWorkspaceDelta(showing, event.payload) };
          });
          setFailed(false);
        });
      }),
      listen<string>(FAILED_EVENT, () => setFailed(true)),
    ]);

    return () => {
      pending
        .then((listeners) => {
          for (const unlisten of listeners) unlisten();
        })
        .catch(() => undefined);
    };
  }, []);

  useEffect(() => {
    return () => {
      held.current.clear();
      if (!retiring) void invoke("close_workspace", {}).catch(() => undefined);
    };
  }, []);

  const workspace = useMemo(() => merge(key ? key.split(SEPARATOR) : [], open), [key, open]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `every` is `roots` by value
  const folders = useMemo(() => group(roots, open), [every, open]);

  return { workspace, folders, loading, failed };
}

/** Repository objects pass through untouched so the graph can keep what did not change. */
function merge(roots: string[], open: Open): Workspace | null {
  const workspaces = roots.map((root) => open[root]).filter(Boolean);
  if (workspaces.length === 0) return null;
  if (workspaces.length === 1) return workspaces[0];

  const byId = new Map<string, Repository>();
  for (const workspace of workspaces) {
    for (const repository of workspace.repositories) {
      if (!byId.has(repository.id)) byId.set(repository.id, repository);
    }
  }

  return {
    root: workspaces.map((workspace) => workspace.root).join(", "),
    repositories: [...byId.values()],
    warnings: workspaces.flatMap((workspace) => workspace.warnings),
  };
}

/**
 * In the order graphed. A repository waits for its scan; a folder is drawn at once. One directory
 * graphed both ways is drawn both ways: the folder's row with its terminals, and the repository
 * beside it.
 */
function group(roots: readonly Graphed[], open: Open): Folder[] {
  const seen = new Set<string>();
  const rows = new Set<string>();
  const folders: Folder[] = [];

  for (const graphed of roots) {
    if (graphed.kind === "folder") {
      if (rows.has(graphed.root)) continue;
      rows.add(graphed.root);
      folders.push({
        kind: "folder",
        root: graphed.root,
        name: baseName(graphed.root),
        repositories: [],
      });
      continue;
    }

    const workspace = open[graphed.root];
    if (!workspace || seen.has(graphed.root)) continue;
    seen.add(graphed.root);

    const repositories: string[] = [];
    for (const repository of workspace.repositories) {
      if (seen.has(repository.id)) continue;
      seen.add(repository.id);
      repositories.push(repository.id);
    }
    folders.push({
      kind: "repository",
      root: workspace.root,
      name: baseName(workspace.root),
      repositories,
    });
  }

  return folders;
}

/** Asked of the folders, not the machine: a WSL folder is read by that distribution's git. */
export function useGitMissing(roots: readonly string[]): boolean {
  const [missing, setMissing] = useState(false);
  // By value: the array is rebuilt each render.
  const key = JSON.stringify([...roots]);

  useEffect(() => {
    let cancelled = false;
    const paths: string[] = JSON.parse(key);
    if (paths.length === 0) {
      setMissing(false);
      return;
    }
    Promise.all(
      paths.map((path) =>
        invoke<string>("git_version", { path }).then(
          () => true,
          () => false,
        ),
      ),
    ).then((answers) => {
      if (!cancelled) setMissing(answers.includes(false));
    });
    return () => {
      cancelled = true;
    };
  }, [key]);

  return missing;
}

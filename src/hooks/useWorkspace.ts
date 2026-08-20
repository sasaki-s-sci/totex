import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";

import { baseName } from "../folder/format";
import { applyWorkspaceDelta } from "../lib/workspaceDelta";
import type { Repository, Workspace, WorkspaceDelta } from "../types/git";

/** Carries what a change actually changed. */
const DELTA_EVENT = "workspace:delta";
/** Says that a refresh could not be completed. What it carries is not read:
 *  the window draws that something is wrong, and nowhere says what. */
const FAILED_EVENT = "workspace:failed";

/** Joins the open folders into one effect dependency. No path on any platform
 *  can contain it, which is what keeps the join reversible. */
const SEPARATOR = "\u0000";

/** What the backend has open, by the path it was asked to open. */
type Open = Record<string, Workspace>;

/**
 * One folder that was put on the graph, and what was found in it.
 *
 * The graph draws folders as well as repositories — a folder is where several
 * repositories are worked on at once, and it is a directory in its own right,
 * which is somewhere a terminal can be opened. So the merge into one workspace
 * is not the whole answer any more: which folder a repository came through is
 * what the canvas groups by.
 *
 * A repository reached through two folders belongs to the first of them, the
 * same way the merged workspace keeps the first copy of it.
 */
export type Folder = {
  /** The path the scan settled on, which is what the folder is known by. */
  root: string;
  name: string;
  /** Its repositories by id, in the order the scan gave them. */
  repositories: string[];
};

/**
 * Opens every folder in `roots` and then follows them.
 *
 * Each folder is its own scan and its own snapshot on the backend, so a commit
 * arrives here as a diff of the one folder it happened in. What the graph draws
 * is the folders put together: several explorers expand into one view, and a
 * repository reached through two of them is still drawn once.
 */
export function useWorkspaces(roots: string[]) {
  const [open, setOpen] = useState<Open>({});
  const [loading, setLoading] = useState(false);
  /** Whether the last thing asked of the backend came back. Nothing about what
   *  it said: what is drawn from this is a rule along the top of the canvas. */
  const [failed, setFailed] = useState(false);

  // Which folders the backend is holding, so a folder that is already open is
  // not scanned again when another one is added next to it.
  const held = useRef(new Set<string>());
  // The listener is registered once, so what it needs to place an incoming
  // delta is read through a ref rather than captured.
  const current = useRef<Open>(open);
  useEffect(() => {
    current.current = open;
  }, [open]);

  const key = roots.join(SEPARATOR);

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
    void Promise.all(
      fresh.map((root) =>
        invoke<Workspace>("scan_workspace", { root })
          .then((workspace) => {
            // The folder can be collapsed while its scan is still running.
            if (held.current.has(root)) setOpen((previous) => ({ ...previous, [root]: workspace }));
          })
          .catch(() => {
            held.current.delete(root);
            setFailed(true);
          }),
      ),
    ).finally(() => setLoading(false));
  }, [key]);

  useEffect(() => {
    const pending = Promise.all([
      listen<WorkspaceDelta>(DELTA_EVENT, (event) => {
        // Deltas name the root their scan settled on, which is not always the
        // path it was asked for -- `~` and `..` are folded, links resolved.
        const entry = Object.entries(current.current).find(
          ([, workspace]) => workspace.root === event.payload.root,
        );
        // A delta for a folder that is no longer open, or one whose own scan is
        // still on its way; either way its scan is what is right.
        if (!entry) return;
        const [root] = entry;

        // A commit landing is the machine talking, not the window being used:
        // laying a repository out again and walking its nodes over is a frame's
        // work, and it waits behind whatever is being done here rather than
        // interrupting it. A scan asked for by pressing a folder is the other
        // kind, and stays urgent.
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
      // No folder named: everything the window had open goes with it.
      void invoke("close_workspace", {}).catch(() => undefined);
    };
  }, []);

  const workspace = useMemo(() => merge(key ? key.split(SEPARATOR) : [], open), [key, open]);
  const folders = useMemo(() => group(key ? key.split(SEPARATOR) : [], open), [key, open]);

  return { workspace, folders, loading, failed };
}

/**
 * The open folders as the single workspace the graph draws.
 *
 * Folder order, and each folder's own order within it: the backend already
 * sorted every scan, and a repository reached through two folders keeps the
 * place the first one gave it. Repository objects are passed through untouched,
 * which is what lets the graph rebuild without moving what did not change.
 */
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
 * The open folders, each with the repositories the graph draws under it.
 *
 * A folder whose scan has not come back yet is left out rather than drawn
 * empty: it would arrive as a row with nothing in it and then grow, which is
 * the canvas moving under whoever asked for it.
 */
function group(roots: string[], open: Open): Folder[] {
  const seen = new Set<string>();
  const folders: Folder[] = [];

  for (const root of roots) {
    const workspace = open[root];
    if (!workspace) continue;

    const repositories: string[] = [];
    for (const repository of workspace.repositories) {
      if (seen.has(repository.id)) continue;
      seen.add(repository.id);
      repositories.push(repository.id);
    }
    folders.push({ root: workspace.root, name: baseName(workspace.root), repositories });
  }

  return folders;
}

/**
 * Whether git is there at all, asked once.
 *
 * Nothing is drawn from it but the same rule every other failure draws: a
 * window whose git is missing can open folders and can draw nothing from them,
 * and the canvas staying empty is most of that answer already.
 */
export function useGitMissing(): boolean {
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    invoke<string>("git_version").catch(() => {
      if (!cancelled) setMissing(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  return missing;
}

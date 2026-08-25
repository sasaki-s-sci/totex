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

/** One folder that was put on the graph, and what was found in it: which folder
 *  a repository came through is what the canvas groups by, and one reached
 *  through two belongs to the first. */
export type Folder = {
  /** The path the scan settled on, which is what the folder is known by. */
  root: string;
  name: string;
  /** Its repositories by id, in the order the scan gave them. */
  repositories: string[];
};

/** Opens every folder in `roots` and then follows them. Each is its own scan and
 *  snapshot on the backend, so a commit arrives as a diff of the one folder it
 *  happened in; what the graph draws is the folders put together. */
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

/** The open folders as the single workspace the graph draws, in folder order.
 *  Repository objects are passed through untouched, which is what lets the graph
 *  rebuild without moving what did not change. */
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

/** The open folders, each with the repositories drawn under it. One whose scan
 *  has not come back is left out rather than drawn empty and then grown. */
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
 * Whether the git that would read these folders is there at all. Asked of the
 * folders rather than of the machine: a folder inside a WSL distribution is read
 * by that distribution's git, and asking about the machine would draw this rule
 * over a window that works perfectly. With nothing open there is nothing to
 * answer for.
 */
export function useGitMissing(roots: readonly string[]): boolean {
  const [missing, setMissing] = useState(false);
  // By value: the array is rebuilt on every render, and each report costs a
  // question per folder.
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

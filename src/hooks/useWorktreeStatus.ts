import { startTransition, useEffect, useMemo, useState } from "react";

import { type WorktreeStatus, worktreeStatuses } from "../lib/workspace";
import type { Workspace } from "../types/git";

/**
 * How often the worktrees are asked again.
 *
 * Asked rather than watched: the backend's watch is aimed at the few files git
 * writes when the history changes, and deliberately not at the working copies —
 * one inotify watch per directory, firing on every build artefact, is what that
 * watch exists to avoid. What is uncommitted moves with the keystrokes of
 * whoever is typing, so it is read on a clock instead.
 *
 * The clock is slow, and the reading is skipped rather than queued when the
 * window is not being looked at or the last reading has not come back. Every
 * tick costs a couple of gits per worktree, and a workspace with a dozen of
 * them on a slow disk can take longer to answer than the tick, at which point
 * the readings stack up and the machine spends its time forking git.
 */
const EVERY_MS = 6000;

/**
 * What is uncommitted in each worktree of a workspace, by directory.
 *
 * Nothing here fails loudly: a worktree whose directory has gone, or which git
 * will not answer for, simply keeps whatever it last said. The graph draws a
 * ring either way, and a branch is not worth an error toast.
 */
export function useWorktreeStatus(
  workspace: Workspace | null,
): ReadonlyMap<string, WorktreeStatus> {
  const [statuses, setStatuses] = useState<ReadonlyMap<string, WorktreeStatus>>(() => new Map());

  const paths = useMemo(() => worktreePaths(workspace), [workspace]);
  // The paths themselves are what the reading depends on. A workspace rebuilt
  // by a delta that touched nothing here is the same set of directories, and
  // restarting the clock for it would leave a fast-changing worktree unread.
  const key = paths.join("\n");

  // biome-ignore lint/correctness/useExhaustiveDependencies: `key` is `paths`
  useEffect(() => {
    if (paths.length === 0) {
      setStatuses((previous) => (previous.size === 0 ? previous : new Map()));
      return;
    }

    let cancelled = false;
    let reading = false;

    const read = () => {
      // One reading at a time. A tick that arrives while git is still out is a
      // tick with nothing to add, and starting another only slows the first.
      if (reading) return;
      reading = true;
      worktreeStatuses(paths)
        .then((answers) => {
          // On a clock and nobody's doing: the rings this draws are worth a
          // frame the window has to spare, not the one it is in the middle of.
          if (!cancelled) {
            startTransition(() => setStatuses((previous) => settle(previous, answers, paths)));
          }
        })
        .catch(() => undefined)
        .finally(() => {
          reading = false;
        });
    };

    read();
    const timer = setInterval(() => {
      // Nobody is looking: what is uncommitted can be read when they come back.
      if (document.visibilityState === "visible" && document.hasFocus()) read();
    }, EVERY_MS);

    // Coming back to the window is worth a reading of its own — that is when the
    // answer is most likely to have moved and most likely to be looked at.
    window.addEventListener("focus", read);

    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", read);
    };
  }, [key]);

  return statuses;
}

/** Every directory worth asking about: a worktree that is there to be read. */
function worktreePaths(workspace: Workspace | null): string[] {
  if (!workspace) return [];
  const paths: string[] = [];
  for (const repository of workspace.repositories) {
    for (const worktree of repository.worktrees) {
      if (worktree.exists && !worktree.bare) paths.push(worktree.path);
    }
  }
  return paths;
}

/**
 * The answers, or the map that was already there.
 *
 * Identity is the whole point: this runs on a clock, and handing back a new map
 * each time would redraw every branch in the graph to say that nothing had
 * changed.
 */
function settle(
  previous: ReadonlyMap<string, WorktreeStatus>,
  answers: Record<string, WorktreeStatus>,
  paths: readonly string[],
): ReadonlyMap<string, WorktreeStatus> {
  const next = new Map(previous);
  let moved = false;

  for (const [path, status] of Object.entries(answers)) {
    const held = next.get(path);
    if (held && same(held, status)) continue;
    next.set(path, status);
    moved = true;
  }

  // A worktree that is no longer in the workspace leaves with its counts. One
  // that is still there but would not answer keeps what it last said.
  const wanted = new Set(paths);
  for (const path of next.keys()) {
    if (wanted.has(path)) continue;
    next.delete(path);
    moved = true;
  }

  return moved ? next : previous;
}

function same(left: WorktreeStatus, right: WorktreeStatus): boolean {
  return (
    left.added === right.added && left.deleted === right.deleted && left.modified === right.modified
  );
}

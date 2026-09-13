import { startTransition, useEffect, useMemo, useState } from "react";

import { type WorktreeStatus, worktreeStatuses } from "../../lib/workspace";
import { worktreePaths } from "../../lib/worktrees";
import type { Workspace } from "../../types/git";

// Polled, not watched: the backend watch avoids working copies on purpose. Skipped while hidden or while a reading is still out.
const EVERY_MS = 6000;

export function useWorktreeStatus(
  workspace: Workspace | null,
): ReadonlyMap<string, WorktreeStatus> {
  const [statuses, setStatuses] = useState<ReadonlyMap<string, WorktreeStatus>>(() => new Map());

  const paths = useMemo(() => worktreePaths(workspace), [workspace]);

  // Keyed by the paths: a delta that rebuilt the workspace must not restart the clock.
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
      if (reading) return;
      reading = true;
      worktreeStatuses(paths)
        .then((answers) => {
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
      if (document.visibilityState === "visible" && document.hasFocus()) read();
    }, EVERY_MS);

    window.addEventListener("focus", read);

    return () => {
      cancelled = true;
      clearInterval(timer);
      window.removeEventListener("focus", read);
    };
  }, [key]);

  return statuses;
}

// Same map identity when nothing changed, or every ring redraws per tick.
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

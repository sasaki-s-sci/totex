import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { FS_CHANGED_EVENT, watchDirectories } from "./api";

/**
 * Which directories the tree has open, and who to tell when one of them moves.
 *
 * A module rather than a context: every expanded level subscribes, and running
 * the whole tree through React state would redraw all of it to tell one row its
 * folder gained a file. The backend is handed the set of open directories and
 * answers with the ones that actually changed, so a directory re-reads itself
 * and nothing else moves.
 */
const open = new Map<string, Set<() => void>>();

let pending: ReturnType<typeof setTimeout> | null = null;
let listener: Promise<UnlistenFn> | null = null;

/**
 * Watches `path` for as long as the returned function has not been called.
 *
 * `onChange` is what the directory does about it — re-read itself — and it is
 * called for the directory's own contents only: a file two levels down belongs
 * to whichever level is showing it.
 */
export function watchDirectory(path: string, onChange: () => void): () => void {
  attach();

  let bucket = open.get(path);
  if (!bucket) {
    bucket = new Set();
    open.set(path, bucket);
    sync();
  }
  bucket.add(onChange);

  return () => {
    const holding = open.get(path);
    if (!holding) return;
    holding.delete(onChange);
    if (holding.size > 0) return;
    open.delete(path);
    sync();
  };
}

/** One listener for the whole tree, started with the first directory. */
function attach() {
  if (listener) return;
  listener = listen<string[]>(FS_CHANGED_EVENT, (event) => {
    for (const path of event.payload) {
      for (const onChange of open.get(path) ?? []) onChange();
    }
  });
}

/**
 * Hands the backend the set as it now stands.
 *
 * Deferred by a tick: expanding a folder mounts its children, which subscribe
 * one after another in the same render, and the watch is worth rebuilding once
 * for all of them rather than once each.
 */
function sync() {
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    void watchDirectories([...open.keys()]).catch(() => undefined);
  }, 0);
}

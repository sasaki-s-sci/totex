import { listen, type UnlistenFn } from "@tauri-apps/api/event";

import { FS_CHANGED_EVENT, watchDirectories } from "../../folder/api";

// A module rather than a context: a directory re-reads itself and nothing else moves.
const open = new Map<string, Set<() => void>>();

let pending: ReturnType<typeof setTimeout> | null = null;
let listener: Promise<UnlistenFn> | null = null;

/** `onChange` is for the directory's own contents only. */
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

function attach() {
  if (listener) return;
  listener = listen<string[]>(FS_CHANGED_EVENT, (event) => {
    for (const path of event.payload) {
      for (const onChange of open.get(path) ?? []) onChange();
    }
  });
}

/** Deferred a tick: expanding a folder subscribes its children one after another in one render. */
function sync() {
  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    void watchDirectories([...open.keys()]).catch(() => undefined);
  }, 0);
}

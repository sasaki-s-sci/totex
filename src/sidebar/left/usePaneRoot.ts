import { useEffect, useState } from "react";
import { type Listing, readDirectory } from "../../folder/api";
import { refreshChanges } from "../../folder/changes";
import { watchDirectory } from "./watch";

// Keep the header and file rows across folder/git switches; always revalidate on mount.
const roots = new Map<string, Listing>();

export function cachedRoot(path: string) {
  return roots.get(path) ?? null;
}

export function usePaneRoot(path: string) {
  const [reading, setReading] = useState(() => ({ path, root: cachedRoot(path) }));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let stale = false;
    let request = 0;
    setReading({ path, root: cachedRoot(path) });
    setFailed(false);
    const read = () => {
      const current = ++request;
      readDirectory(path, true)
        .then((listing) => {
          if (stale || current !== request) return;
          roots.delete(path);
          roots.set(path, listing);
          const oldest = roots.keys().next().value;
          if (roots.size > 100 && oldest !== undefined) roots.delete(oldest);
          setReading({ path, root: listing });
          setFailed(false);
        })
        .catch(() => {
          if (stale || current !== request) return;
          roots.delete(path);
          setFailed(true);
        });
    };
    read();
    const stop = watchDirectory(path, () => {
      read();
      refreshChanges();
    });
    return () => {
      stale = true;
      stop();
    };
  }, [path]);

  return { root: reading.path === path ? reading.root : cachedRoot(path), failed };
}

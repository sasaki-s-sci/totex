import { useEffect, useState } from "react";
import { type Listing, readDirectory } from "../../folder/api";
import { watchDirectory } from "./watch";

// Keep the header's last answer across folder/git switches; always revalidate on mount.
const roots = new Map<string, Listing>();

export function usePaneRoot(path: string) {
  const [root, setRoot] = useState(() => roots.get(path) ?? null);

  useEffect(() => {
    let stale = false;
    let request = 0;
    setRoot(roots.get(path) ?? null);
    const read = () => {
      const current = ++request;
      readDirectory(path, true)
        .then((listing) => {
          if (stale || current !== request) return;
          roots.delete(path);
          roots.set(path, listing);
          const oldest = roots.keys().next().value;
          if (roots.size > 100 && oldest !== undefined) roots.delete(oldest);
          setRoot(listing);
        })
        .catch(() => {
          if (stale || current !== request) return;
          roots.delete(path);
          setRoot(null);
        });
    };
    read();
    const stop = watchDirectory(path, read);
    return () => {
      stale = true;
      stop();
    };
  }, [path]);

  return root?.path === path ? root : null;
}

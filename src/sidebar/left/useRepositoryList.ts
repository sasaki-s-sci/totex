import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type FoundRepository,
  listRepositories,
  REPOSITORY_FOUND_EVENT,
  type RepositoryFound,
  stopListing,
} from "../../folder/api";
import { byName, withFound } from "./repoOrder";
import { watchDirectory } from "./watch";

// One token per walk asked, for the window: an event is answered to the walk that found it.
let nextToken = 0;
const walking = new Map<number, (found: RepositoryFound) => void>();
let listener: Promise<UnlistenFn> | null = null;

function attach() {
  if (listener) return;
  listener = listen<RepositoryFound>(REPOSITORY_FOUND_EVENT, (event) => {
    walking.get(event.payload.token)?.(event.payload);
  });
}

/** A walk asked for: the count tells one asking from the next, `shown` whether the bar goes up. */
interface Walk {
  count: number;
  /** Asked by the person (or the first of a root): the bar says the rows are still coming. */
  shown: boolean;
}

/**
 * The repositories under `root`, a row at a time as the walk finds them and then whole. The walk
 * runs off the UI thread and is stopped when the pane goes; a change to the root's own contents
 * walks it again, keeping the rows drawn until the new list answers.
 *
 * Walks are taken one at a time: a change that lands while a walk is under way asks for one more
 * once it has ended, rather than cutting it short — a root that keeps changing would otherwise
 * never be listed whole, and the bar would never come down. A walk the root's changes asked for
 * runs behind the rows already there without a bar; the bar is for a walk the person asked for,
 * and for the first walk of a root, where there are no rows yet to look at.
 */
export function useRepositoryList(root: string) {
  const [rows, setRows] = useState<FoundRepository[]>([]);
  const [listing, setListing] = useState(true);
  const [failed, setFailed] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [walk, setWalk] = useState<Walk>({ count: 0, shown: true });
  const listed = useRef<string | null>(null);
  // The walk under way, and whether one more was asked for while it ran (and how).
  const busy = useRef(false);
  const again = useRef<boolean | null>(null);

  const ask = useCallback((shown: boolean) => {
    if (busy.current) {
      // The louder asking wins: a person's refresh is not made quiet by a change beside it.
      again.current = (again.current ?? false) || shown;
      return;
    }
    setWalk((last) => ({ count: last.count + 1, shown }));
  }, []);
  const refresh = useCallback(() => ask(true), [ask]);
  const noticed = useCallback(() => ask(false), [ask]);

  useEffect(() => {
    attach();
    const token = ++nextToken;
    let stale = false;
    // A root not listed before starts empty; a walk of the same root keeps what the last one found.
    const first = listed.current !== root;
    if (first) {
      listed.current = root;
      setRows([]);
      setTruncated(false);
    }
    if (first || walk.shown) setListing(true);
    setFailed(false);
    busy.current = true;

    const settle = () => {
      busy.current = false;
      const more = again.current;
      again.current = null;
      if (more !== null) setWalk((last) => ({ count: last.count + 1, shown: more }));
    };

    walking.set(token, (found) => {
      setRows((held) => withFound(held, { path: found.path, name: found.name }));
    });
    listRepositories(root, token)
      .then((list) => {
        if (stale) return;
        // The whole list stands in for the rows: a repository gone since the last walk goes too.
        setRows([...list.repositories].sort(byName));
        setTruncated(list.truncated);
        setListing(false);
      })
      .catch((error: unknown) => {
        if (stale) return;
        // Stopped by nobody here: whatever came is what there is, and the bar has nothing to wait for.
        if (error !== "stopped") setFailed(true);
        setListing(false);
      })
      .finally(() => {
        // An event still on its way for this walk has nothing to say now.
        walking.delete(token);
        if (!stale) settle();
      });

    return () => {
      stale = true;
      busy.current = false;
      again.current = null;
      walking.delete(token);
      void stopListing(token).catch(() => undefined);
    };
  }, [root, walk]);

  // The root's own contents only: a repository made or removed straight under it. Deeper changes
  // are the rows' to notice.
  useEffect(() => watchDirectory(root, noticed), [root, noticed]);

  return { rows, listing, failed, truncated, refresh };
}

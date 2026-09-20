import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type Listing, readDirectory } from "../../folder/api";
import { refreshChanges, useDirectoryChanges } from "../../folder/changes";
import { useHolding } from "./holding";
import { FIRST_ROWS, MORE_ROWS } from "./rows";
import { watchDirectory } from "./watch";

export function useLevel(
  path: string,
  depth: number,
  onNavigate: ((path: string) => void) | undefined,
  onListing: ((listing: Listing) => void) | undefined,
  /** Whether the rows offer the repository list: where they do not, nothing is walked for it. */
  listsRepositories: boolean,
) {
  const [listing, setListing] = useState<Listing | null>(null);
  const [failed, setFailed] = useState(false);
  const [expanded, setExpanded] = useState<readonly string[]>([]);
  const [shown, setShown] = useState(FIRST_ROWS);
  const [reads, setReads] = useState(0);

  const rows = listing ? listing.entries.slice(0, shown) : [];
  const rest = listing ? listing.entries.length - rows.length : 0;
  // The rows drawn, not the whole listing: a folder far down a long level is asked about when it
  // is reached.
  const holding = useHolding(
    listsRepositories ? rows.filter((entry) => entry.isDir).map((entry) => entry.path) : [],
    reads,
  );

  const answer = useDirectoryChanges(path);
  // A Map, not the object: a file called `constructor` would otherwise find a non-colour.
  const changes = useMemo(() => new Map(Object.entries(answer.changed)), [answer]);
  const ignored = useMemo(() => new Set(answer.ignored), [answer]);

  const drawMore = useCallback(() => {
    startTransition(() => setShown((count) => count + MORE_ROWS));
  }, []);

  // Read, not captured: a handler changing identity is no reason to re-read.
  const report = useRef({ onNavigate, onListing });
  report.current = { onNavigate, onListing };

  useEffect(() => {
    let cancelled = false;

    // Only the first reading empties the level; a re-read replaces rows in place to avoid flicker.
    const read = (announce: boolean) => {
      if (announce) {
        setListing(null);
        setFailed(false);
        setShown(FIRST_ROWS);
      }
      // Hidden entries are shown like the rest: the leading dot already says it.
      readDirectory(path, true)
        .then((next) => {
          if (cancelled) return;
          setListing(next);
          setFailed(false);
          setReads((count) => count + 1);
          report.current.onListing?.(next);
          // `~`, `..` and the legacy WSL share are folded by the backend; the pane moves to the
          // path that answered. A level that cannot be moved stays where it was asked.
          if (depth === 0 && next.path !== path) report.current.onNavigate?.(next.path);
        })
        .catch(() => {
          if (!cancelled) setFailed(true);
        });
    };

    read(true);
    // Watched while on screen; a write re-reads the rows and their git colours on the same event.
    const stop = watchDirectory(path, () => {
      read(false);
      refreshChanges();
    });

    return () => {
      cancelled = true;
      stop();
    };
  }, [path, depth]);

  return {
    failed,
    expanded,
    setExpanded,
    rows,
    rest,
    shown,
    changes,
    allIgnored: answer.allIgnored,
    ignored,
    holding,
    drawMore,
  };
}

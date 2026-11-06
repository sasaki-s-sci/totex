import { startTransition, useCallback, useEffect, useMemo, useRef } from "react";
import type { Listing } from "../../folder/api";
import { useDirectoryChanges } from "../../folder/changes";
import { useFrontState } from "../../shell/state";
import { FIRST_ROWS, MORE_ROWS } from "./rows";
import { usePaneRoot } from "./usePaneRoot";

export function useLevel(
  pane: number,
  path: string,
  depth: number,
  onNavigate: ((path: string) => void) | undefined,
  onListing: ((listing: Listing) => void) | undefined,
) {
  const { root: listing, failed } = usePaneRoot(path);
  const [expanded, setExpanded] = useFrontState<readonly string[]>(
    `folders.expanded.${pane}:${path}`,
    [],
  );
  const [shown, setShown] = useFrontState(`folders.shown.${pane}:${path}`, FIRST_ROWS);

  const rows = listing ? listing.entries.slice(0, shown) : [];
  const rest = listing ? listing.entries.length - rows.length : 0;
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
    if (!listing) return;
    report.current.onListing?.(listing);
    // The backend resolves aliases such as `~`; move only levels that can navigate.
    if (depth === 0 && listing.path !== path) report.current.onNavigate?.(listing.path);
  }, [listing, path, depth]);

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
    drawMore,
  };
}

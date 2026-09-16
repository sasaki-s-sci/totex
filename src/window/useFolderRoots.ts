import { useCallback, useMemo, useState } from "react";
import { type Graphed, type PaneSeed, readGraphed } from "../lib/graphed";
import { remember } from "../lib/remembered";
import { ROOTS_KEY, storedRoots } from "../parts";
import { useFrontState } from "../shell/state";

/**
 * Graphed places go to the canvas; the panes themselves are only remembered, and the paths they
 * are browsing light the worktrees they stand in.
 */
export function useFolderRoots() {
  // Read as a claim: an earlier front kept paths alone under this key.
  const [held, setRoots] = useFrontState<Graphed[]>("window.roots", []);
  const roots = useMemo(() => readGraphed(held), [held]);
  const [initial] = useState(storedRoots);
  const [browsing, setBrowsing] = useState<readonly string[]>(() =>
    initial.map((seed) => seed.path),
  );
  const browse = useCallback((paths: string[]) => setBrowsing(paths), []);
  const keep = useCallback((panes: PaneSeed[]) => remember(ROOTS_KEY, panes), []);
  return { roots, setRoots, initial, browsing, browse, keep };
}

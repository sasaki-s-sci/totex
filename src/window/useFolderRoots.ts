import { useCallback, useState } from "react";
import { remember } from "../lib/remembered";
import { ROOTS_KEY, storedRoots } from "../parts";
import { useFrontState } from "../shell/state";

/** Graphed folders are scanned; browsed folders are only remembered. */
export function useFolderRoots() {
  const [roots, setRoots] = useFrontState<string[]>("window.roots", []);
  const [initial] = useState(storedRoots);
  const [browsing, setBrowsing] = useState<readonly string[]>(initial);
  const browse = useCallback((folders: string[]) => {
    setBrowsing(folders);
    remember(ROOTS_KEY, folders);
  }, []);
  return { roots, setRoots, initial, browsing, browse };
}

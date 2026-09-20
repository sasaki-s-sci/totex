import { useEffect, useState } from "react";
import { foldersHoldingRepositories } from "../../folder/api";

const NONE: ReadonlySet<string> = new Set();

/**
 * Which of `folders` hold a repository, asked together. Empty until the walk answers, so a mark
 * for the list arrives late rather than being drawn and taken back; a re-asking keeps the answer
 * it has until the next one lands. `read` is asked again for whenever it moves: the folders can be
 * the same ones and one of them have become a repository.
 */
export function useHolding(folders: readonly string[], read = 0): ReadonlySet<string> {
  const [holding, setHolding] = useState(NONE);

  // By value: the rows are a new array every render.
  const key = folders.join("\u0000");
  // biome-ignore lint/correctness/useExhaustiveDependencies: `read` is the asking, not an input
  useEffect(() => {
    if (!key) {
      setHolding(NONE);
      return;
    }
    let cancelled = false;
    foldersHoldingRepositories(key.split("\u0000"))
      .then((held) => {
        if (!cancelled) setHolding(new Set(held));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [key, read]);

  return holding;
}

import { useCallback, useState } from "react";

/**
 * How much history each repository is showing, by id.
 *
 * A repository that has not been asked shows the default; `Infinity` is the
 * whole of it, however far it grows. Folding and expanding are the same move
 * with a different number, so they are the same call.
 */
export function useHistoryDepth() {
  const [visible, setVisible] = useState<ReadonlyMap<string, number>>(() => new Map());

  const fold = useCallback((repository: string, shown: number) => {
    setVisible((current) => {
      // The same answer is not a change, and the graph is rebuilt from this.
      if (current.get(repository) === shown) return current;
      return new Map(current).set(repository, shown);
    });
  }, []);

  const expand = useCallback(
    (repository: string) => fold(repository, Number.POSITIVE_INFINITY),
    [fold],
  );

  return { visible, expand, fold };
}

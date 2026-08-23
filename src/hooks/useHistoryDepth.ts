import { useCallback, useMemo, useRef, useState } from "react";

/** A depth a pull has got to, which is not yet a depth anything is showing. */
type Reaching = { repository: string; shown: number };

/**
 * How much history each repository is showing, by id.
 *
 * A repository that has not been asked shows the default; `Infinity` is the
 * whole of it, however far it grows. Folding and expanding are the same move
 * with a different number, so they are the same call.
 *
 * A pull is that number again, held apart until the hand lets go: `reach` is
 * where the pull has got to and `keep` is what makes it the repository's own.
 * Apart rather than written straight in, for two reasons. A pull that is let go
 * where it began has to leave nothing behind, and that is only possible while
 * what it was asking for is still separable from what was already settled. And
 * a depth that has only been reached is drawn as a proposal — see the band's
 * `provisional` — which is a thing the graph can only know by being told which
 * repository is under the hand.
 */
export function useHistoryDepth() {
  const [settled, setSettled] = useState<ReadonlyMap<string, number>>(() => new Map());
  const [reaching, setReaching] = useState<Reaching | null>(null);
  // The same answer again, for the release that ends a pull: `keep` runs in the
  // event that follows the pull's last frame, and the state that frame asked
  // for has not necessarily been rendered by then.
  const held = useRef<Reaching | null>(null);

  const visible = useMemo(
    () => (reaching ? new Map(settled).set(reaching.repository, reaching.shown) : settled),
    [settled, reaching],
  );

  const fold = useCallback((repository: string, shown: number) => {
    setSettled((current) => {
      // The same answer is not a change, and the graph is rebuilt from this.
      if (current.get(repository) === shown) return current;
      return new Map(current).set(repository, shown);
    });
  }, []);

  const expand = useCallback(
    (repository: string) => fold(repository, Number.POSITIVE_INFINITY),
    [fold],
  );

  const reach = useCallback((repository: string, shown: number | null) => {
    if (shown === null) {
      // Only the pull's own. A pull is let go before another can begin, so this
      // is a guard rather than a case, and the one it guards against is a stale
      // node ending a pull that is no longer its.
      if (held.current?.repository !== repository) return;
      held.current = null;
      setReaching(null);
      return;
    }

    const now = { repository, shown };
    held.current = now;
    setReaching((current) =>
      current && current.repository === repository && current.shown === shown ? current : now,
    );
  }, []);

  const keep = useCallback(
    (repository: string) => {
      const now = held.current;
      if (!now || now.repository !== repository) return;
      held.current = null;
      // Both at once, so the depth is never let go of between the two: what was
      // being reached for becomes what is shown, and the band stops being drawn
      // as a proposal, in the one rebuild.
      setReaching(null);
      fold(now.repository, now.shown);
    },
    [fold],
  );

  return {
    visible,
    /** The repository a pull is under way in, whose band is only proposed. */
    reaching: reaching?.repository ?? null,
    expand,
    fold,
    reach,
    keep,
  };
}

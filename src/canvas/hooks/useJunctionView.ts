import { useCallback, useState } from "react";

/**
 * Which knots have been pressed shut, by node id.
 *
 * Only what was actually pressed is held: a knot nobody has touched is not in
 * here at all, and stands open with its fan drawn, which is how a namespace
 * reads until somebody says otherwise. The id carries the repository and the
 * prefix both — see `junctionId` — so `dev/` shut in one repository says
 * nothing about `dev/` in the next.
 */
export function useJunctionView() {
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());

  /** The knot itself: shut the fan away, or open it out again. */
  const toggleJunction = useCallback((junction: string) => {
    setClosed((current) => {
      const next = new Set(current);
      if (!next.delete(junction)) next.add(junction);
      return next;
    });
  }, []);

  return { closed, toggleJunction };
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useAppSettings } from "../../lib/appSettings";
import { type Drawn, settleDepths } from "../../lib/graph/depths";
import { useFrontState } from "../../shell/state";
import type { Repository } from "../../types/git";

// An object, so asking for the same depth twice is two asks: the band may have grown since.
type Ask = { shown: number };

type Reaching = { repository: string; shown: number };

export function useHistoryDepth(repositories: readonly Repository[]) {
  const { historyLength, historyFollow } = useAppSettings();
  const [settled, setSettled] = useFrontState<ReadonlyMap<string, Ask>>(
    "canvas.history",
    () => new Map(),
  );
  // The repositories that keep their place in history while the rest follow the length.
  const [free, setFree] = useFrontState<ReadonlySet<string>>(
    "canvas.history.free",
    () => new Set(),
  );
  const [reaching, setReaching] = useState<Reaching | null>(null);

  // keep runs in the event after the pull's last frame, before that frame's state has rendered.
  const held = useRef<Reaching | null>(null);

  const drawn = useRef<ReadonlyMap<string, Drawn<Ask | Reaching>>>(new Map());

  // A new length is for every repository: the ones given a length of their own give it up.
  const given = useRef(historyLength);
  useEffect(() => {
    if (given.current === historyLength) return;
    given.current = historyLength;
    setSettled((current) => (current.size === 0 ? current : new Map()));
  }, [historyLength]);

  const visible = useMemo(() => {
    const { shown, drawn: now } = settleDepths(
      repositories,
      (repository) => {
        const proposed = reaching?.repository === repository;
        return { ask: proposed ? reaching : settled.get(repository), proposed };
      },
      drawn.current,
      { length: historyLength, follow: historyFollow, free },
    );
    drawn.current = now;
    return shown;
  }, [repositories, settled, reaching, historyLength, historyFollow, free]);

  const fold = useCallback((repository: string, shown: number) => {
    setSettled((current) => new Map(current).set(repository, { shown }));
  }, []);

  const expand = useCallback(
    (repository: string) => fold(repository, Number.POSITIVE_INFINITY),
    [fold],
  );

  const follow = useCallback((repository: string, following: boolean) => {
    setFree((current) => {
      if (current.has(repository) !== following) return current;
      const next = new Set(current);
      if (following) next.delete(repository);
      else next.add(repository);
      return next;
    });
  }, []);

  const reach = useCallback((repository: string, shown: number | null) => {
    if (shown === null) {
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

      setReaching(null);
      fold(now.repository, now.shown);
    },
    [fold],
  );

  return {
    visible,
    free,

    reaching: reaching?.repository ?? null,
    expand,
    fold,
    follow,
    reach,
    keep,
  };
}

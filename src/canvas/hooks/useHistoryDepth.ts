import { useCallback, useMemo, useRef, useState } from "react";
import { depthOf } from "../../lib/graph/history";
import { useFrontState } from "../../shell/state";
import type { Repository } from "../../types/git";

// An object, so asking for the same depth twice is two asks: the band may have grown since.
type Ask = { shown: number };

type Reaching = { repository: string; shown: number };

type Drawn = {
  ask: Ask | Reaching | undefined;

  oldest: string;
};

export function useHistoryDepth(repositories: readonly Repository[]) {
  const [settled, setSettled] = useFrontState<ReadonlyMap<string, Ask>>(
    "canvas.history",
    () => new Map(),
  );
  const [reaching, setReaching] = useState<Reaching | null>(null);

  // keep runs in the event after the pull's last frame, before that frame's state has rendered.
  const held = useRef<Reaching | null>(null);

  const drawn = useRef<ReadonlyMap<string, Drawn>>(new Map());

  const visible = useMemo(() => {
    const shown = new Map<string, number>();
    const now = new Map<string, Drawn>();

    for (const repository of repositories) {
      const proposed = reaching?.repository === repository.id;
      const ask = proposed ? reaching : settled.get(repository.id);
      const before = drawn.current.get(repository.id);

      const kept =
        before && before.ask === ask
          ? repository.commits.findIndex((commit) => commit.id === before.oldest) + 1
          : 0;

      // A fold is a place in history, not a distance from the tip: new commits lengthen the band without moving it.
      const depth = Math.max(depthOf(repository, ask?.shown), kept);
      shown.set(repository.id, depth);

      const oldest = repository.commits[depth - 1];
      const entry = proposed ? before : oldest && { ask, oldest: oldest.id };
      if (entry) now.set(repository.id, entry);
    }

    drawn.current = now;
    return shown;
  }, [repositories, settled, reaching]);

  const fold = useCallback((repository: string, shown: number) => {
    setSettled((current) => new Map(current).set(repository, { shown }));
  }, []);

  const expand = useCallback(
    (repository: string) => fold(repository, Number.POSITIVE_INFINITY),
    [fold],
  );

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

    reaching: reaching?.repository ?? null,
    expand,
    fold,
    reach,
    keep,
  };
}

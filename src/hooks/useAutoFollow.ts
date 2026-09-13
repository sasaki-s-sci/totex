// Only a branch that is merely behind its remote moves; `follow_repository` holds that rule.

import { useCallback, useEffect, useMemo, useRef } from "react";

import { onFetchAsked, sayFetching, useFollowing } from "../lib/follow";
import { fetchRepository, followRepository } from "../lib/workspace";
import type { Repository } from "../types/git";

// Minutes: this catches somebody else's push, not a live feed.
const EVERY = 5 * 60_000;

export function useAutoFollow(repositories: readonly Repository[]) {
  const following = useFollowing();

  // Keyed on the id set: a rescan hands back new objects several times a minute.
  const key = useMemo(
    () => repositories.map((repository) => repository.id).join("\0"),
    [repositories],
  );

  const latest = useRef(repositories);
  latest.current = repositories;

  const asked = useRef(new Map<string, number>());

  const open = useRef(true);
  useEffect(
    () => () => {
      open.current = false;
    },
    [],
  );

  // Rounds queue behind each other: two inside one repository trip git's lock.
  const queue = useRef<Promise<void>>(Promise.resolve());

  const round = useCallback((pressed: boolean) => {
    const pass = async () => {
      const now = Date.now();
      const wanted = new Set<string>();
      let missed = false;
      // One at a time; nothing waits on this.
      for (const repository of latest.current) {
        if (!open.current) break;
        wanted.add(repository.id);
        if (!pressed && now - (asked.current.get(repository.id) ?? 0) < EVERY) continue;
        // Stamped before the crossing so a remote that never answers is asked at the same rate.
        asked.current.set(repository.id, now);
        if (pressed) {
          await fetchRepository(repository.id).catch(() => {
            missed = true;
          });
        } else {
          await followRepository(repository.id).catch(() => undefined);
        }
      }
      for (const id of asked.current.keys()) {
        if (!wanted.has(id)) asked.current.delete(id);
      }
      if (pressed) sayFetching(missed ? "failed" : "rest");
    };

    queue.current = queue.current.then(pass);
    return queue.current;
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the repository set is the trigger, not an input
  useEffect(() => {
    if (!following) return;
    let alive = true;
    let again: ReturnType<typeof setTimeout> | undefined;

    const turn = async () => {
      await round(false);
      if (alive) again = setTimeout(() => void turn(), EVERY);
    };

    void turn();

    return () => {
      alive = false;
      clearTimeout(again);
    };
  }, [following, key, round]);

  // Heard even while following is off: the button is the explicit ask.
  useEffect(() => onFetchAsked(() => void round(true)), [round]);
}

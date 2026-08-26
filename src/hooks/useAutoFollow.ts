/**
 * The round that keeps every branch up with its remote, while the setting for
 * it is on.
 *
 * The one thing in this window that touches somebody's network without being
 * asked, so what it does is deliberately the smallest thing that could be
 * called following: each repository is asked for what its remotes have, and a
 * branch that was only behind is taken up to it. A branch with commits of its
 * own, or with anything uncommitted under it, is left exactly where it was —
 * see `follow_repository`, which is where that rule actually lives.
 */

import { useEffect, useMemo, useRef } from "react";

import { useFollowing } from "../lib/follow";
import { followRepository } from "../lib/workspace";
import type { Repository } from "../types/git";

/**
 * How long a repository is left before its remotes are asked again.
 *
 * Far longer than a fetch takes and far shorter than a working day. What is
 * being caught is somebody else pushing, which happens on the scale of minutes;
 * asking faster would be a connection per repository per minute for news that
 * arrives a few times an hour.
 */
const EVERY = 5 * 60_000;

export function useAutoFollow(repositories: readonly Repository[]) {
  const following = useFollowing();

  // The set rather than the list: a rescan hands back new repository objects
  // several times a minute, and a round that restarted on each of them would
  // be a round that never got past its first repository.
  const key = useMemo(
    () => repositories.map((repository) => repository.id).join("\0"),
    [repositories],
  );

  const latest = useRef(repositories);
  latest.current = repositories;

  /** When each repository was last asked, so a restart does not ask it again. */
  const asked = useRef(new Map<string, number>());

  // biome-ignore lint/correctness/useExhaustiveDependencies: the repository set is the trigger, not an input
  useEffect(() => {
    if (!following) return;
    let alive = true;
    let again: ReturnType<typeof setTimeout> | undefined;

    const round = async () => {
      const now = Date.now();
      const wanted = new Set<string>();
      // One at a time. A window with a dozen repositories open should not open
      // a dozen connections because a timer went off, and nothing is waiting on
      // this: the graph redraws whenever a repository actually moves.
      for (const repository of latest.current) {
        if (!alive) return;
        wanted.add(repository.id);
        if (now - (asked.current.get(repository.id) ?? 0) < EVERY) continue;
        // Written down before the crossing rather than after it, so that a
        // remote which will not answer is asked at the same rate as one that
        // will, and not on every restart of the round.
        asked.current.set(repository.id, now);
        await followRepository(repository.id).catch(() => undefined);
      }
      // A repository that is no longer on the graph is forgotten, so that a
      // folder put back is asked again rather than waiting out its old turn.
      for (const id of asked.current.keys()) {
        if (!wanted.has(id)) asked.current.delete(id);
      }
      if (alive) again = setTimeout(() => void round(), EVERY);
    };

    void round();

    return () => {
      alive = false;
      clearTimeout(again);
    };
    // `key` restarts the round when a repository arrives or leaves, which is
    // what asks a newly opened folder straight away; the ones already asked sit
    // out their turn.
  }, [following, key]);
}

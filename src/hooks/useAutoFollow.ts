/**
 * The round that keeps every branch up with its remote: on a timer while the
 * setting for it is on, and on the press beside it whenever somebody asks.
 *
 * The one thing in this window that touches somebody's network without being
 * asked, so what it does is deliberately the smallest thing that could be
 * called following: each repository is asked for what its remotes have, and a
 * branch that was only behind is taken up to it. A branch with commits of its
 * own, or with anything uncommitted under it, is left exactly where it was —
 * see `follow_repository`, which is where that rule actually lives.
 *
 * The press does the same round and nothing more, so there is nothing to be had
 * by pressing that leaving the window open would not have done on its own. It
 * is here rather than on the settings page because this is where the
 * repositories are: the page is a card on the canvas that knows about none of
 * them, and it asks through the store the checkbox already goes through.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";

import { onFetchAsked, sayFetching, useFollowing } from "../lib/follow";
import { fetchRepository, followRepository } from "../lib/workspace";
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

  /** False once the window is going, which stops a round part way through. */
  const open = useRef(true);
  useEffect(
    () => () => {
      open.current = false;
    },
    [],
  );

  /**
   * Rounds run one behind another rather than over each other. Two of them
   * inside one repository is git tripping over its own lock, and a press that
   * lands while the timer's round is half way through would be exactly that.
   */
  const queue = useRef<Promise<void>>(Promise.resolve());

  const round = useCallback((pressed: boolean) => {
    const pass = async () => {
      const now = Date.now();
      const wanted = new Set<string>();
      /** A remote that would not answer, which only a press is told about. */
      let missed = false;
      // One at a time. A window with a dozen repositories open should not open
      // a dozen connections because a timer went off, and nothing is waiting on
      // this: the graph redraws whenever a repository actually moves.
      for (const repository of latest.current) {
        if (!open.current) break;
        wanted.add(repository.id);
        // A round somebody pressed for asks every repository whatever its turn
        // was. What a press is for is the news now, and a repository sitting
        // out the rest of its five minutes is the one thing it cannot answer.
        if (!pressed && now - (asked.current.get(repository.id) ?? 0) < EVERY) continue;
        // Written down before the crossing rather than after it, so that a
        // remote which will not answer is asked at the same rate as one that
        // will, and not on every restart of the round.
        asked.current.set(repository.id, now);
        if (pressed) {
          await fetchRepository(repository.id).catch(() => {
            missed = true;
          });
        } else {
          await followRepository(repository.id).catch(() => undefined);
        }
      }
      // A repository that is no longer on the graph is forgotten, so that a
      // folder put back is asked again rather than waiting out its old turn.
      for (const id of asked.current.keys()) {
        if (!wanted.has(id)) asked.current.delete(id);
      }
      // One answer for the press however many repositories it crossed to: what
      // the button can say is that the round was made, or that something in it
      // could not be reached. Which repository is on the graph, in the branches
      // that did not move.
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
    // `key` restarts the round when a repository arrives or leaves, which is
    // what asks a newly opened folder straight away; the ones already asked sit
    // out their turn.
  }, [following, key, round]);

  // Heard whether or not the window is following. The setting above the button
  // is about what this window does unasked, and somebody who will not have it
  // on their network unasked still wants to ask.
  useEffect(() => onFetchAsked(() => void round(true)), [round]);
}

import { useCallback, useMemo, useRef, useState } from "react";
import { depthOf } from "../lib/graph/history";
import type { Repository } from "../types/git";

/**
 * A depth somebody asked a repository for.
 *
 * An object rather than the number itself, so that two asks for the same depth
 * are two asks: what a number means is where the fold stands, and a band that
 * has grown since is no longer standing where that number last put it. A press
 * that asks for what was asked for before has to be answered all the same.
 */
type Ask = { shown: number };

/** A depth a pull has got to, which is not yet a depth anything is showing. */
type Reaching = { repository: string; shown: number };

/** What a repository was last drawn showing, which is where its fold stands. */
type Drawn = {
  /** The ask it was drawn for, or none where what it drew was the default. */
  ask: Ask | Reaching | undefined;
  /** The oldest commit it reached, which is the fold's place in the history. */
  oldest: string;
};

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
 *
 * What comes out is a count per repository, and it is settled against the
 * history each of them holds now: a number is what the fold is asked for by,
 * and a place in the history is what it stands at.
 */
export function useHistoryDepth(repositories: readonly Repository[]) {
  const [settled, setSettled] = useState<ReadonlyMap<string, Ask>>(() => new Map());
  const [reaching, setReaching] = useState<Reaching | null>(null);
  // The same answer again, for the release that ends a pull: `keep` runs in the
  // event that follows the pull's last frame, and the state that frame asked
  // for has not necessarily been rendered by then.
  const held = useRef<Reaching | null>(null);

  // What each repository was last drawn showing. A ref rather than state: it is
  // an answer already given, kept only so the same one can be given again, and
  // writing it down is not a reason to draw anything.
  const drawn = useRef<ReadonlyMap<string, Drawn>>(new Map());

  const visible = useMemo(() => {
    const shown = new Map<string, number>();
    const now = new Map<string, Drawn>();

    for (const repository of repositories) {
      // A pull's own repository is showing what the hand has reached; every
      // other one is showing what it settled on, or the default where it has
      // never been asked anything.
      const proposed = reaching?.repository === repository.id;
      const ask = proposed ? reaching : settled.get(repository.id);
      const before = drawn.current.get(repository.id);
      // Where a fold stands is a place in the history rather than a distance
      // from the tip of it. A commit landing at that tip puts nothing away: it
      // lengthens what is drawn, and the oldest commit on the canvas — with the
      // branches standing on it, and everything working in those — is still on
      // the canvas afterwards. Only being asked again moves the fold, which is
      // the handle on the fold itself and the click that opens it; and history
      // rewritten under the fold takes the answer back to what the ask alone
      // says, since the place the fold stood at is gone.
      const kept =
        before && before.ask === ask
          ? repository.commits.findIndex((commit) => commit.id === before.oldest) + 1
          : 0;

      const depth = Math.max(depthOf(repository, ask?.shown), kept);
      shown.set(repository.id, depth);

      // A proposal is not what the repository is showing, so it is not written
      // down as what the repository was drawn at: a pull let go where it began
      // has to leave nothing behind, and where it began is what this holds.
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

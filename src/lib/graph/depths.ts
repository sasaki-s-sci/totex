import type { Repository } from "../../types/git";
import { depthOf } from "./history";

/** How one band was last drawn, which is what a fold that is a place in history is held against. */
export type Drawn<Ask> = {
  ask: Ask | undefined;

  /** The length every band is given, as it stood when this was drawn. */
  length: number;

  oldest: string;
};

export type Lengths = {
  /** The length a band with none of its own is given. */
  length: number;
  /** Whether bands are cut back to their length as commits arrive. */
  follow: boolean;
  /** The repositories that keep their place in history all the same. */
  free: ReadonlySet<string>;
};

/** How many commits each band shows, and what that leaves to be held against next time. */
export function settleDepths<Ask extends { shown: number }>(
  repositories: readonly Repository[],
  asked: (repository: string) => { ask: Ask | undefined; proposed: boolean },
  before: ReadonlyMap<string, Drawn<Ask>>,
  { length, follow, free }: Lengths,
): { shown: Map<string, number>; drawn: Map<string, Drawn<Ask>> } {
  const shown = new Map<string, number>();
  const drawn = new Map<string, Drawn<Ask>>();

  for (const repository of repositories) {
    const { ask, proposed } = asked(repository.id);
    const was = before.get(repository.id);

    // Following, a fold is a distance from the tip: new commits push the oldest out.
    const follows = follow && !free.has(repository.id) && !proposed;

    const kept =
      !follows && was && was.ask === ask && was.length === length
        ? repository.commits.findIndex((commit) => commit.id === was.oldest) + 1
        : 0;

    // Otherwise a fold is a place in history: new commits lengthen the band without moving it.
    const depth = Math.max(depthOf(repository, ask?.shown, length), kept);
    shown.set(repository.id, depth);

    const oldest = repository.commits[depth - 1];
    const entry = proposed ? was : oldest && { ask, length, oldest: oldest.id };
    if (entry) drawn.set(repository.id, entry);
  }

  return { shown, drawn };
}

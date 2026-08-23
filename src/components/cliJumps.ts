import { createContext, useContext } from "react";

/**
 * The number each terminal is answering to, by the id of the mark that draws
 * it — or null while nothing is asking.
 *
 * Only while Ctrl is held. The numbers are a way through the window rather than
 * anything about the terminals themselves: a mark that carried one all the time
 * would be a mark saying which of a list it is, on a canvas whose whole point is
 * that terminals are in places rather than in a list.
 *
 * Passed through context rather than through node data, for the same reason the
 * actions and the worktree counts are: React Flow decides what to redraw by
 * comparing that data, and a number that comes and goes with a key would rebuild
 * the layout each time it did.
 */
export type CliJumps = ReadonlyMap<string, number> | null;

const CliJumpsContext = createContext<CliJumps>(null);

export const CliJumpsProvider = CliJumpsContext.Provider;

/** What this mark is answering to, or null while nothing is asking. */
export function useCliJump(id: string): number | null {
  return useContext(CliJumpsContext)?.get(id) ?? null;
}

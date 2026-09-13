import { createContext, useContext } from "react";

/**
 * The last thing typed at each terminal, by the id of the session — or null
 * while nothing is asking.
 *
 * The other half of what Ctrl puts on the marks. The number says which of them
 * a key would reach; this says which of them is which, because a stack of
 * terminal glyphs is a stack of identical marks and what tells them apart is
 * what somebody set each of them going on.
 *
 * The one of the two that can also be asked for outright: a window whose
 * terminals are each on a different thing is a window where these lines are
 * what is being read, and the choice for that is in settings — see `said`.
 *
 * Passed through context rather than through node data, for the same reason the
 * numbers are: React Flow decides what to redraw by comparing that data, and a
 * line that comes and goes with a key would rebuild the layout each time it
 * did. See `cliJumps`, which comes and goes with the same key.
 */
export type CliTyped = ReadonlyMap<string, string> | null;

const CliTypedContext = createContext<CliTyped>(null);

export const CliTypedProvider = CliTypedContext.Provider;

/** What was last typed at this session, or null while nothing is asking. */
export function useTypedLine(session: string): string | null {
  return useContext(CliTypedContext)?.get(session) ?? null;
}

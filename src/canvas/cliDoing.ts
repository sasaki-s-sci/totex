import { createContext, useContext } from "react";

import type { Doing } from "../lib/doing";

/**
 * What each terminal is doing, by the id of the session.
 *
 * Passed through context rather than through node data, for the same reason the
 * numbers and the lines are: React Flow decides what to redraw by comparing
 * that data, and a state that turns over twice a command would rebuild the
 * layout every time somebody ran something. Through here it costs a render of
 * the marks and of nothing else on the canvas.
 *
 * Not null the way the other two are. Those come and go with a key; this is
 * simply what is running, and a session nothing has been heard about yet is one
 * that is missing from the map rather than a map that is not there.
 */
export type CliDoing = ReadonlyMap<string, Doing>;

const CliDoingContext = createContext<CliDoing>(new Map());

export const CliDoingProvider = CliDoingContext.Provider;

/**
 * What this session is doing, or null while nothing has been heard about it —
 * a shell in the moment between being started and printing its prompt.
 */
export function useCliDoing(session: string): Doing | null {
  return useContext(CliDoingContext).get(session) ?? null;
}

import { createContext, useContext } from "react";

/**
 * What the row a terminal is standing on is called, by the id of that row.
 *
 * A repository's name or a folder's, which is the same word already drawn over
 * that place on the canvas — read off the run the panel's strip is drawn from,
 * so the name a mark gives and the name heading that mark's run in the band are
 * one reading rather than two.
 *
 * Through context rather than through node data, for the reason the numbers and
 * the doings are: React Flow decides what to redraw by comparing that data, and
 * a word that arrives with the graph would rebuild the layout it arrives with.
 */
export type CliPlaces = ReadonlyMap<string, string>;

/** Nothing is standing anywhere until the canvas has been read. */
const NOWHERE: CliPlaces = new Map();

const CliPlacesContext = createContext<CliPlaces>(NOWHERE);

export const CliPlacesProvider = CliPlacesContext.Provider;

/** What the row this mark hangs on is called, or null for a row with no name of
 *  its own. */
export function useCliPlace(group: string): string | null {
  return useContext(CliPlacesContext).get(group) ?? null;
}

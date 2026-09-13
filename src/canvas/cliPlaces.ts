import { createContext, useContext } from "react";

export type CliPlaces = ReadonlyMap<string, string>;

const NOWHERE: CliPlaces = new Map();

const CliPlacesContext = createContext<CliPlaces>(NOWHERE);

export const CliPlacesProvider = CliPlacesContext.Provider;

export function useCliPlace(group: string): string | null {
  return useContext(CliPlacesContext).get(group) ?? null;
}

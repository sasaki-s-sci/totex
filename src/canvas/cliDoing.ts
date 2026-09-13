import { createContext, useContext } from "react";

import type { Doing } from "../lib/doing";

export type CliDoing = ReadonlyMap<string, Doing>;

const CliDoingContext = createContext<CliDoing>(new Map());

export const CliDoingProvider = CliDoingContext.Provider;

export function useCliDoing(session: string): Doing | null {
  return useContext(CliDoingContext).get(session) ?? null;
}

import { createContext, useContext } from "react";

export type CliJumps = ReadonlyMap<string, number> | null;

const CliJumpsContext = createContext<CliJumps>(null);

export const CliJumpsProvider = CliJumpsContext.Provider;

export function useCliJump(id: string): number | null {
  return useContext(CliJumpsContext)?.get(id) ?? null;
}

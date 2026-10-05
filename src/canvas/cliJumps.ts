import { createContext, useContext } from "react";

/** Every terminal's number, drawn beside its mark. */
export type CliJumps = {
  numbers: ReadonlyMap<string, number>;
};

const NONE: CliJumps = { numbers: new Map() };

const CliJumpsContext = createContext<CliJumps>(NONE);

export const CliJumpsProvider = CliJumpsContext.Provider;

export function useCliJump(id: string): number | null {
  return useContext(CliJumpsContext).numbers.get(id) ?? null;
}

import { createContext, useContext } from "react";

/** Every terminal's number, and whether Ctrl is held: the numbers are always drawn, the labels only while held. */
export type CliJumps = {
  numbers: ReadonlyMap<string, number>;
  holding: boolean;
};

const NONE: CliJumps = { numbers: new Map(), holding: false };

const CliJumpsContext = createContext<CliJumps>(NONE);

export const CliJumpsProvider = CliJumpsContext.Provider;

export function useCliJump(id: string): number | null {
  return useContext(CliJumpsContext).numbers.get(id) ?? null;
}

export function useCliHolding(): boolean {
  return useContext(CliJumpsContext).holding;
}

import { createContext, useContext } from "react";

/** Every terminal's number, drawn along its incoming edge. */
export type CliJumps = {
  numbers: ReadonlyMap<string, number>;
  showing: string | null;
};

const NONE: CliJumps = { numbers: new Map(), showing: null };

const CliJumpsContext = createContext<CliJumps>(NONE);

export const CliJumpsProvider = CliJumpsContext.Provider;

export function useCliJumps(): CliJumps {
  return useContext(CliJumpsContext);
}

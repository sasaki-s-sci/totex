import { createContext, useContext } from "react";

export type CliTyped = ReadonlyMap<string, string> | null;

const CliTypedContext = createContext<CliTyped>(null);

export const CliTypedProvider = CliTypedContext.Provider;

export function useTypedLine(session: string): string | null {
  return useContext(CliTypedContext)?.get(session) ?? null;
}

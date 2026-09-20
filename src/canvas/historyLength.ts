import { createContext, useContext } from "react";

export type HistoryLength = {
  /** Commits drawn, by repository. */
  visible: ReadonlyMap<string, number>;
  /** The repositories that do not follow the length every band is given. */
  free: ReadonlySet<string>;
  follow: (repository: string, following: boolean) => void;
};

const HistoryLengthContext = createContext<HistoryLength>({
  visible: new Map(),
  free: new Set(),
  follow: () => {},
});

export const HistoryLengthProvider = HistoryLengthContext.Provider;

export function useHistoryLength(): HistoryLength {
  return useContext(HistoryLengthContext);
}

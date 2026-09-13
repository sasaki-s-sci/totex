import { createContext, useCallback, useContext, useSyncExternalStore } from "react";

export type GraphMark = "busy" | "failed" | null;

export type GraphMarks = {
  get: (key: string) => GraphMark;
  subscribe: (key: string, changed: () => void) => () => void;
};

export function branchMark(repositoryId: string, branch: string): string {
  return `${repositoryId} ${branch}`;
}

export const NO_MARKS: GraphMarks = {
  get: () => null,
  subscribe: () => () => {},
};

// A keyed store rather than props: a prop change on Canvas walked the whole React Flow tree twice per merge.
const GraphMarksContext = createContext<GraphMarks>(NO_MARKS);

export const GraphMarksProvider = GraphMarksContext.Provider;

export function useGraphMark(key: string): GraphMark {
  const marks = useContext(GraphMarksContext);
  const subscribe = useCallback(
    (changed: () => void) => marks.subscribe(key, changed),
    [key, marks],
  );
  const snapshot = useCallback(() => marks.get(key), [key, marks]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

import { createContext, useCallback, useContext, useSyncExternalStore } from "react";

/**
 * The states a branch's mark can be in that are nobody's history: what a press
 * on it could not do, and what is being done to it right now.
 *
 * Both are the window talking about itself rather than about the repository, so
 * they are held here and not in the node's data — React Flow decides what to
 * redraw by comparing that data, and a state that comes and goes on its own
 * would rebuild the layout each time it did. The same argument as
 * `worktreeStatus`, which is passed the same way.
 *
 * They are drawn and never written. A ring that goes red is a refusal and a
 * ring that pulses is an operation still running, and neither needs a word to
 * say which branch it belongs to: it is drawn on that branch.
 */
export type GraphMark = "busy" | "failed" | null;

/**
 * A keyed store rather than a pair of values passed through the graph.
 *
 * A merge changes one branch ring. Making that change a prop of `GitGraph`
 * made React walk the complete React Flow canvas twice — once when the command
 * started and once when it answered. Subscribers are keyed by branch, so the
 * ring concerned is now the only component React has to visit.
 */
export type GraphMarks = {
  get: (key: string) => GraphMark;
  /**
   * What a refusal said, where it said anything: git's own words for two ends
   * that would not come together.
   *
   * Almost every refusal has none. The window already knew why — a worktree
   * with work in it, a branch that is not there — and the red ring is the whole
   * of the answer. This is for the one case where only git has read both sides.
   */
  note: (key: string) => string | null;
  subscribe: (key: string, changed: () => void) => () => void;
};

/** A branch, keyed so that two repositories can hold the same name. */
export function branchMark(repositoryId: string, branch: string): string {
  return `${repositoryId} ${branch}`;
}

export const NO_MARKS: GraphMarks = {
  get: () => null,
  note: () => null,
  subscribe: () => () => {},
};

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

/** The words a refusal came with, and null for the refusals that came without. */
export function useGraphNote(key: string): string | null {
  const marks = useContext(GraphMarksContext);
  const subscribe = useCallback(
    (changed: () => void) => marks.subscribe(key, changed),
    [key, marks],
  );
  const snapshot = useCallback(() => marks.note(key), [key, marks]);
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

import { useCallback, useEffect, useMemo, useRef } from "react";

import type { GraphMark, GraphMarks } from "../components/graphMarks";

/** How long a refusal stays on the mark it happened to. */
const HOLD_MS = 2400;

/**
 * The window's answer to a failure, which is to show it where it happened.
 *
 * Nothing is said about it. A branch whose merge would not go through goes red
 * for a moment and is then a branch again, which is what happened: the graph
 * did not move, and the mark that was pressed is the one that answers. What can
 * be refused for a reason the window can know beforehand is not offered at all
 * — see the menus, where those items are simply not pressable.
 */
export function useMarks() {
  const state = useRef({
    failed: new Set<string>(),
    busy: new Set<string>(),
    listeners: new Map<string, Set<() => void>>(),
  });
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const emit = useCallback((key: string) => {
    for (const changed of state.current.listeners.get(key) ?? []) changed();
  }, []);

  useEffect(() => {
    const held = timers.current;
    return () => {
      for (const timer of held.values()) clearTimeout(timer);
      held.clear();
    };
  }, []);

  const fail = useCallback(
    (key: string) => {
      state.current.failed.add(key);
      emit(key);
      const running = timers.current.get(key);
      if (running) clearTimeout(running);
      timers.current.set(
        key,
        setTimeout(() => {
          timers.current.delete(key);
          if (state.current.failed.delete(key)) emit(key);
        }, HOLD_MS),
      );
    },
    [emit],
  );

  const hold = useCallback(
    (key: string) => {
      if (!state.current.busy.has(key)) {
        state.current.busy.add(key);
        emit(key);
      }
    },
    [emit],
  );

  const release = useCallback(
    (key: string) => {
      if (state.current.busy.delete(key)) emit(key);
    },
    [emit],
  );

  const marks = useMemo<GraphMarks>(
    () => ({
      get(key): GraphMark {
        if (state.current.busy.has(key)) return "busy";
        if (state.current.failed.has(key)) return "failed";
        return null;
      },
      subscribe(key, changed) {
        const listeners = state.current.listeners.get(key) ?? new Set();
        listeners.add(changed);
        state.current.listeners.set(key, listeners);
        return () => {
          listeners.delete(changed);
          if (listeners.size === 0) state.current.listeners.delete(key);
        };
      },
    }),
    [],
  );

  return { marks, fail, hold, release };
}

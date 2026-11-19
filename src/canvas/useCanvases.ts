import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { readOnSnapshot, useFrontState } from "../shell/state";
import { type CanvasPane, paneSource, type TerminalCanvas } from "./model";

export function useCanvases() {
  const [canvases, setCanvases] = useFrontState<Record<string, TerminalCanvas>>(
    "canvas.terminals",
    {},
  );
  const current = useRef(canvases);
  const saves = useRef(new Map<string, () => Promise<boolean>>());
  const queue = useRef(Promise.resolve());
  const [error, setError] = useState<string | null>(null);
  useEffect(
    () =>
      readOnSnapshot("canvas.terminals", async () => {
        await queue.current.catch(() => undefined);
        return current.current;
      }),
    [],
  );
  const accept = useCallback(async (next: TerminalCanvas) => {
    const was = current.current[next.id];
    if (was && was.revision >= next.revision) return;
    for (const pane of was?.panes ?? []) {
      const replacement = next.panes.find((one) => one.id === pane.id);
      if (replacement && paneSource(replacement) === paneSource(pane)) continue;
      if ((await saves.current.get(`${next.id}/${pane.id}`)?.()) === false)
        throw new Error("Save the edited file before replacing this pane.");
    }
    // Another read/write may have finished while a file was saving.
    if ((current.current[next.id]?.revision ?? -1) >= next.revision) return;
    current.current = { ...current.current, [next.id]: next };
    setCanvases(current.current);
    setError(null);
  }, []);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const all = await invoke<TerminalCanvas[]>("canvas_read");
        if (!live) return;
        for (const next of all) await accept(next);
      } catch (failure) {
        if (live) setError(String(failure));
      }
      if (live) timer = setTimeout(poll, 750);
    };
    void poll();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [accept]);

  const change = useCallback(
    (id: string, update: (panes: CanvasPane[]) => CanvasPane[]) => {
      const operation = queue.current
        .catch(() => undefined)
        .then(async () => {
          // A file can be opened before the first poll has restored the agent's canvas.
          for (const next of await invoke<TerminalCanvas[]>("canvas_read")) await accept(next);
          const was = current.current[id] ?? { id, revision: 0, panes: [] };
          const panes = update(was.panes);
          // Save first; a failed save never removes a file from the canonical canvas.
          for (const pane of was.panes) {
            const next = panes.find((one) => one.id === pane.id);
            if (next && paneSource(next) === paneSource(pane)) continue;
            if ((await saves.current.get(`${id}/${pane.id}`)?.()) === false)
              throw new Error("Save the edited file before removing this pane.");
          }
          const next = await invoke<TerminalCanvas>("canvas_write", {
            id,
            panes,
            revision: was.revision,
          });
          await accept(next);
          setError(null);
        });
      queue.current = operation;
      void operation.catch((failure) => setError(String(failure)));
      return operation;
    },
    [accept],
  );
  const registerSave = useCallback((key: string, save: () => Promise<boolean>) => {
    saves.current.set(key, save);
    return () => {
      saves.current.delete(key);
    };
  }, []);
  const saveSession = useCallback(async (id: string) => {
    try {
      await queue.current.catch(() => undefined);
      for (const pane of current.current[id]?.panes ?? []) {
        if ((await saves.current.get(`${id}/${pane.id}`)?.()) === false)
          throw new Error("Save the terminal's edited files before closing it.");
      }
      return true;
    } catch (failure) {
      setError(String(failure));
      return false;
    }
  }, []);
  return { canvases, change, registerSave, saveSession, error, clearError: () => setError(null) };
}

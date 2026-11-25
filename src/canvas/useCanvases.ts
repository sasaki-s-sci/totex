import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";
import { readOnSnapshot, useFrontState } from "../shell/state";
import { canvasGeometry } from "./geometry";
import {
  type CanvasSplit,
  type Edge,
  fitSplit,
  insertSplit,
  readLayouts,
  reconcileSplit,
  tileSplit,
} from "./layout";
import { type CanvasPane, paneSource, type TerminalCanvas } from "./model";

export function useCanvases() {
  const [canvases, setCanvases] = useFrontState<Record<string, TerminalCanvas>>(
    "canvas.terminals",
    {},
  );
  const [layouts, setLayouts] = useFrontState<Record<string, CanvasSplit>>("canvas.layouts", () => {
    try {
      return readLayouts(JSON.parse(localStorage.getItem("totex.canvas.layouts") ?? "{}"));
    } catch {
      return {};
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem("totex.canvas.layouts", JSON.stringify(layouts));
    } catch {}
  }, [layouts]);
  const current = useRef(canvases);
  const saves = useRef(new Map<string, () => Promise<boolean>>());
  const queue = useRef(Promise.resolve());
  const opened = useRef(new Map<string, Promise<void>>());
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
    setLayouts((before) => {
      if (!before[next.id]) return before;
      const tree = reconcileSplit(
        before[next.id],
        was?.panes.map((pane) => pane.id) ?? [],
        next.panes.map((pane) => pane.id),
      );
      const updated = { ...before };
      if (tree) updated[next.id] = tree;
      else delete updated[next.id];
      return updated;
    });
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
    (
      id: string,
      update: (panes: CanvasPane[]) => CanvasPane[],
      placement?: { source: string; edge: Edge; target?: string },
    ) => {
      const operation = queue.current
        .catch(() => undefined)
        .then(async () => {
          await opened.current.get(id);
          // A file can be opened before the first poll has restored the agent's canvas.
          for (const next of await invoke<TerminalCanvas[]>("canvas_read")) await accept(next);
          const was = current.current[id] ?? { id, revision: 0, panes: [] };
          const panes = update(was.panes);
          const element = document.querySelector(`[data-session-canvas="${CSS.escape(id)}"]`);
          const geometry = placement && element ? canvasGeometry(element) : null;
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
          if (placement)
            setLayouts((before) => {
              const ids = was.panes.map((pane) => pane.id);
              const tree = before[id]
                ? reconcileSplit(before[id], [], ids)
                : tileSplit(ids, geometry?.aspect ?? 1);
              const placed = insertSplit(
                tree && geometry ? fitSplit(tree, geometry.panes) : tree,
                placement.source,
                placement.edge,
                placement.target,
              );
              const latest = reconcileSplit(
                placed,
                [],
                (current.current[id]?.panes ?? []).map((pane) => pane.id),
              );
              return latest ? { ...before, [id]: latest } : before;
            });
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
  const arrange = useCallback((id: string, tree: CanvasSplit) => {
    const panes = current.current[id]?.panes ?? [];
    const next = reconcileSplit(
      tree,
      [],
      panes.map((pane) => pane.id),
    );
    if (next) setLayouts((before) => ({ ...before, [id]: next }));
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
  const open = useCallback(
    (id: string, cwd: string) => {
      const pending = opened.current.get(id);
      if (pending) return pending;
      const opening = invoke<TerminalCanvas>("canvas_open", { id, cwd })
        .then(accept)
        .catch((failure) => {
          opened.current.delete(id);
          setError(String(failure));
          throw failure;
        });
      opened.current.set(id, opening);
      return opening;
    },
    [accept],
  );
  const close = useCallback(
    async (id: string) => {
      await opened.current.get(id);
      if (!(await saveSession(id)))
        throw new Error("Save the edited files before closing this canvas.");
      await invoke("canvas_close", { id });
      opened.current.delete(id);
      const remaining = { ...current.current };
      delete remaining[id];
      current.current = remaining;
      setCanvases(remaining);
      setLayouts((before) => {
        const next = { ...before };
        delete next[id];
        return next;
      });
    },
    [saveSession],
  );
  return {
    open,
    close,
    canvases,
    layouts,
    arrange,
    change,
    registerSave,
    saveSession,
    error,
    clearError: () => setError(null),
  };
}

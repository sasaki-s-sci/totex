import { type KeyboardEvent, type MouseEvent, useEffect, useRef, useState } from "react";
import type { SelectionEntry } from "../../lib/fileSelection";
import { typing } from "../../lib/keys";

export type { SelectionEntry } from "../../lib/fileSelection";

/** Set on every row a pane can pick, so ranges follow the visible tree order. */
export const PICK_ROW = "data-pick-row";
export const PICK_DIRECTORY = "data-pick-directory";

export function useSelection(scope: string) {
  const [selected, setSelected] = useState<readonly SelectionEntry[]>([]);
  const anchor = useRef<string | null>(null);
  const pane = useRef<HTMLElement | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: navigating the pane resets its selection
  useEffect(() => {
    setSelected([]);
    anchor.current = null;
    const node = pane.current;
    if (!node) return;
    const prune = () => {
      const visible = new Map(rowsOf(node).map((entry) => [entry.path, entry]));
      setSelected((held) => {
        const next = held.flatMap((entry) => {
          const current = visible.get(entry.path);
          return current ? [current] : [];
        });
        return next.length === held.length &&
          next.every((entry, index) => entry.isDir === held[index].isDir)
          ? held
          : next;
      });
      if (anchor.current && !visible.has(anchor.current)) anchor.current = null;
    };
    const observer = new MutationObserver(prune);
    observer.observe(node, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [PICK_DIRECTORY],
    });
    return () => observer.disconnect();
  }, [scope]);

  function pick({ path, isDir }: SelectionEntry, event: MouseEvent<HTMLElement>) {
    const entry = { path, isDir };
    const adding = event.ctrlKey || event.metaKey;
    if (event.shiftKey && anchor.current) {
      const range = between(rowsOf(event.currentTarget), anchor.current, entry.path);
      if (range) {
        setSelected((held) =>
          adding
            ? [...held, ...range.filter((one) => !held.some((item) => item.path === one.path))]
            : range,
        );
        return;
      }
    }
    anchor.current = entry.path;
    if (adding) {
      setSelected((held) =>
        held.some((one) => one.path === entry.path)
          ? held.filter((one) => one.path !== entry.path)
          : [...held, entry],
      );
    } else setSelected([entry]);
  }

  /** Right-click and drag preserve the selection only when their row belongs to it. */
  function point({ path, isDir }: SelectionEntry): readonly SelectionEntry[] {
    const entry = { path, isDir };
    if (selected.some((one) => one.path === entry.path)) return selected;
    anchor.current = entry.path;
    setSelected([entry]);
    return [entry];
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (typing(event.target)) return;
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === "a") {
      event.preventDefault();
      event.stopPropagation();
      const rows = rowsOf(event.currentTarget);
      setSelected(rows);
      anchor.current = rows[0]?.path ?? null;
    } else if (event.key === "Escape") {
      event.stopPropagation();
      setSelected([]);
      anchor.current = null;
    }
  }

  return { selected, pick, point, pane, onKeyDown };
}

/** A folder picked alongside other rows does not open or close. */
export function picksMore(event: MouseEvent): boolean {
  return event.ctrlKey || event.metaKey || event.shiftKey;
}

function rowsOf(row: HTMLElement): SelectionEntry[] {
  const pane = row.closest("section");
  if (!pane) return [];
  return [...pane.querySelectorAll<HTMLElement>(`[${PICK_ROW}]`)].map((one) => ({
    path: one.getAttribute(PICK_ROW) ?? "",
    isDir: one.getAttribute(PICK_DIRECTORY) === "true",
  }));
}

/** A collapsed anchor cannot select rows hidden beneath it. */
function between(rows: SelectionEntry[], from: string, to: string): SelectionEntry[] | null {
  const start = rows.findIndex((entry) => entry.path === from);
  const end = rows.findIndex((entry) => entry.path === to);
  if (start < 0 || end < 0) return null;
  return rows.slice(Math.min(start, end), Math.max(start, end) + 1);
}

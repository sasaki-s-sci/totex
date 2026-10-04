import { type MouseEvent, useRef, useState } from "react";

/** Set on every row a pane can pick, so a range is read in the order the rows are drawn. */
export const PICK_ROW = "data-pick-row";

/**
 * Held by a pane. A plain click picks one row; Ctrl adds or takes one away; Shift picks the rows
 * between the last plain or Ctrl pick and this one, and Ctrl+Shift adds them to what is picked.
 */
export function useSelection() {
  const [selected, setSelected] = useState<readonly string[]>([]);
  const anchor = useRef<string | null>(null);

  function pick(path: string, event: MouseEvent<HTMLElement>) {
    const adding = event.ctrlKey || event.metaKey;
    if (event.shiftKey && anchor.current) {
      const range = between(rowsOf(event.currentTarget), anchor.current, path);
      if (range) {
        setSelected((held) => (adding ? [...new Set([...held, ...range])] : range));
        return;
      }
    }
    anchor.current = path;
    if (adding) {
      setSelected((held) =>
        held.includes(path) ? held.filter((one) => one !== path) : [...held, path],
      );
    } else {
      setSelected([path]);
    }
  }

  /** A row pointed at for its menu keeps what is picked if it is among it, else is picked alone. */
  function point(path: string): readonly string[] {
    if (selected.includes(path)) return selected;
    anchor.current = path;
    setSelected([path]);
    return [path];
  }

  return { selected, pick, point };
}

/** Whether a click asks for more than the row: a folder picked this way is not opened. */
export function picksMore(event: MouseEvent): boolean {
  return event.ctrlKey || event.metaKey || event.shiftKey;
}

/** The pane's rows as drawn, folders opened out included. */
function rowsOf(row: HTMLElement): string[] {
  const pane = row.closest("section");
  if (!pane) return [];
  return [...pane.querySelectorAll<HTMLElement>(`[${PICK_ROW}]`)].map(
    (one) => one.getAttribute(PICK_ROW) ?? "",
  );
}

/** The anchor may have gone out of sight with a folder shut; then there is no range to take. */
function between(rows: string[], from: string, to: string): string[] | null {
  const start = rows.indexOf(from);
  const end = rows.indexOf(to);
  if (start < 0 || end < 0) return null;
  return rows.slice(Math.min(start, end), Math.max(start, end) + 1);
}

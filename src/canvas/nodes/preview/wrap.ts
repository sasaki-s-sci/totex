import { useLayoutEffect, useState } from "react";

type Point = [Node, number];

/**
 * How many rows each of the paper's lines takes once wrapped, read off the layout: the gutter and
 * the change marks count rows, not lines, so they stay level with the text. Null while unwrapped.
 */
export function useWrappedRows(
  paper: HTMLElement | null,
  wrapped: boolean,
  lines: number,
): readonly number[] | null {
  const [rows, setRows] = useState<readonly number[] | null>(null);

  useLayoutEffect(() => {
    if (!paper || !wrapped) {
      setRows(null);
      return;
    }
    let frame = 0;
    const read = () => {
      frame = 0;
      const next = rowsOf(paper, lines);
      setRows((held) => (held && same(held, next) ? held : next));
    };
    const later = () => {
      if (!frame) frame = requestAnimationFrame(read);
    };
    read();
    // Typing within a line can wrap it anew without changing how many lines there are.
    const observer = new ResizeObserver(later);
    observer.observe(paper);
    paper.addEventListener("input", later);
    return () => {
      observer.disconnect();
      paper.removeEventListener("input", later);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [paper, wrapped, lines]);

  return rows;
}

/** The gutter's numbers with a blank row under each for every row its line wraps onto. */
export function wrappedNumbers(rows: readonly number[]): string {
  return rows.map((count, index) => String(index + 1) + "\n".repeat(count - 1)).join("\n");
}

/** The row a line starts on, counted from zero, for a box measured in rows. */
export function rowOf(rows: readonly number[] | null, line: number): number {
  if (!rows) return line;
  let row = 0;
  for (let index = 0; index < Math.min(line, rows.length); index += 1) row += rows[index];
  return row;
}

function rowsOf(paper: HTMLElement, lines: number): number[] {
  const range = document.createRange();
  const rows: number[] = [];
  let start: Point = [paper, 0];
  const close = (end: Point) => {
    range.setStart(...start);
    range.setEnd(...end);
    rows.push(rowCount(range.getClientRects()));
  };

  const walk = (node: Node) => {
    for (const child of node.childNodes) {
      if (child.nodeType === Node.TEXT_NODE) {
        const text = child.nodeValue ?? "";
        for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1)) {
          close([child, at]);
          start = [child, at + 1];
        }
      } else if (child.nodeName === "BR") {
        const index = [...node.childNodes].indexOf(child as ChildNode);
        close([node, index]);
        start = [node, index + 1];
      } else {
        walk(child);
      }
    }
  };
  walk(paper);
  close([paper, paper.childNodes.length]);

  // A final line break ends the last line rather than starting another, as `countLines` reads it.
  while (rows.length < lines) rows.push(1);
  return rows.slice(0, Math.max(1, lines));
}

/** Rects on one row share a top; an empty line has none and still takes its row. */
function rowCount(rects: DOMRectList): number {
  const tops = [...rects]
    .filter((rect) => rect.width > 0)
    .map((rect) => rect.top)
    .sort((a, b) => a - b);
  let count = 0;
  let last = Number.NEGATIVE_INFINITY;
  for (const top of tops) {
    if (top - last > 1) count += 1;
    last = top;
  }
  return Math.max(1, count);
}

function same(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

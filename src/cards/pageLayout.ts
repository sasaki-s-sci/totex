export type PageLayout = readonly string[][];
export type PageSide = "left" | "right" | "top" | "bottom";

export function reconcileLayout(rows: PageLayout, ids: readonly string[]): PageLayout {
  const remaining = new Set(ids);
  const kept = rows
    .map((row) => row.filter((id) => remaining.delete(id)))
    .filter((row) => row.length > 0);
  return [...kept, ...Array.from(remaining, (id) => [id])];
}

export function movePage(
  rows: PageLayout,
  source: string,
  target: string,
  side: PageSide,
): PageLayout {
  if (source === target || !rows.some((row) => row.includes(source))) return rows;
  if (!rows.some((row) => row.includes(target))) return rows;
  const next = rows
    .map((row) => (row.includes(source) ? row.filter((id) => id !== source) : row))
    .filter((row) => row.length > 0);
  const at = next.findIndex((row) => row.includes(target));
  if (side === "top" || side === "bottom") {
    next.splice(at + Number(side === "bottom"), 0, [source]);
  } else {
    const row = [...next[at]];
    row.splice(row.indexOf(target) + Number(side === "right"), 0, source);
    next[at] = row;
  }
  return next;
}

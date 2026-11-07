type Box = { left: number; right: number; top: number; bottom: number };

/** Prefer the same visual row, then the nearest card in the requested direction. */
export function horizontalNeighbor<T extends Box>(
  source: Box,
  candidates: readonly T[],
  direction: "left" | "right",
): T | undefined {
  const gap = (box: Box) =>
    direction === "left" ? source.left - box.right : box.left - source.right;
  const vertical = (box: Box) => Math.max(0, source.top - box.bottom, box.top - source.bottom);
  return candidates
    .filter((box) => box.right > box.left && box.bottom > box.top && gap(box) >= -1)
    .sort(
      (a, b) =>
        vertical(a) - vertical(b) ||
        gap(a) - gap(b) ||
        Math.abs(a.top + a.bottom - source.top - source.bottom) -
          Math.abs(b.top + b.bottom - source.top - source.bottom),
    )[0];
}

import { type CanvasGrid, tileLayout } from "./model.ts";

export type Axis = "columns" | "rows";
export type Edge = "left" | "right" | "top" | "bottom";
export type Rectangle = { left: number; top: number; width: number; height: number };
export type CanvasSplit =
  | string
  | { axis: Axis; ratio: number; first: CanvasSplit; second: CanvasSplit };

export function readLayouts(value: unknown): Record<string, CanvasSplit> {
  const valid = (node: unknown, ids: Set<string>, depth = 0): node is CanvasSplit => {
    if (depth > 64 || ids.size >= 128) return false;
    if (typeof node === "string") {
      if (!node || ids.has(node)) return false;
      ids.add(node);
      return true;
    }
    if (!node || typeof node !== "object") return false;
    const part = node as Partial<Exclude<CanvasSplit, string>>;
    return (
      (part.axis === "columns" || part.axis === "rows") &&
      typeof part.ratio === "number" &&
      Number.isFinite(part.ratio) &&
      part.ratio > 0 &&
      part.ratio < 1 &&
      valid(part.first, ids, depth + 1) &&
      valid(part.second, ids, depth + 1)
    );
  };
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, tree]) => valid(tree, new Set())));
}

function mapSplit(
  tree: CanvasSplit,
  replace: (id: string) => CanvasSplit | null,
): CanvasSplit | null {
  if (typeof tree === "string") return replace(tree);
  const first = mapSplit(tree.first, replace);
  const second = mapSplit(tree.second, replace);
  return first && second ? { ...tree, first, second } : (first ?? second);
}

/** Preserve slots on swaps/replacements, and close the gap when a pane disappears. */
export function reconcileSplit(
  tree: CanvasSplit,
  before: readonly string[],
  after: readonly string[],
): CanvasSplit | null {
  const renamed = new Map(
    before.length === after.length ? before.map((id, i) => [id, after[i]]) : [],
  );
  const seen = new Set<string>();
  let next = mapSplit(tree, (id) => {
    const name = renamed.get(id) ?? id;
    if (!after.includes(name) || seen.has(name)) return null;
    seen.add(name);
    return name;
  });
  for (const id of after) {
    if (seen.has(id)) continue;
    next = next ? { axis: "columns", ratio: 0.5, first: next, second: id } : id;
  }
  return next;
}

export function tileSplit(ids: readonly string[], aspect: number): CanvasSplit | null {
  if (!ids.length) return null;
  const { cells, rows } = tileLayout(ids.length, aspect);
  const join = (nodes: CanvasSplit[], weights: number[], axis: Axis): CanvasSplit =>
    nodes.length === 1
      ? nodes[0]
      : {
          axis,
          ratio: weights[0] / weights.reduce((sum, weight) => sum + weight, 0),
          first: nodes[0],
          second: join(nodes.slice(1), weights.slice(1), axis),
        };
  const bands = Array.from({ length: rows }, (_, row) => {
    const indices = cells.flatMap((cell, index) => (cell.row === row ? [index] : []));
    return join(
      indices.map((index) => ids[index]),
      indices.map((index) => cells[index].span),
      "columns",
    );
  });
  return join(
    bands,
    bands.map(() => 1),
    "rows",
  );
}

export function splitRects(tree: CanvasSplit): Record<string, Rectangle> {
  const rects = new Map<string, Rectangle>();
  const visit = (node: CanvasSplit, rect: Rectangle) => {
    if (typeof node === "string") {
      rects.set(node, rect);
      return;
    }
    const size = node.axis === "columns" ? "width" : "height";
    const position = node.axis === "columns" ? "left" : "top";
    visit(node.first, { ...rect, [size]: rect[size] * node.ratio });
    visit(node.second, {
      ...rect,
      [position]: rect[position] + rect[size] * node.ratio,
      [size]: rect[size] * (1 - node.ratio),
    });
  };
  visit(tree, { left: 0, top: 0, width: 1, height: 1 });
  return Object.fromEntries(rects);
}

/** Start a new split from the visible sizes, including previous divider drags. */
export function fitSplit(tree: CanvasSplit, rects: Record<string, Rectangle>): CanvasSplit {
  const visit = (node: CanvasSplit): { tree: CanvasSplit; rect?: Rectangle } => {
    if (typeof node === "string") return { tree: node, rect: rects[node] };
    const a = visit(node.first);
    const b = visit(node.second);
    if (!a.rect || !b.rect) return { tree: node };
    const size = node.axis === "columns" ? "width" : "height";
    const total = a.rect[size] + b.rect[size];
    const left = Math.min(a.rect.left, b.rect.left);
    const top = Math.min(a.rect.top, b.rect.top);
    return {
      tree: {
        ...node,
        first: a.tree,
        second: b.tree,
        ratio: total > 0 ? a.rect[size] / total : node.ratio,
      },
      rect: {
        left,
        top,
        width: Math.max(a.rect.left + a.rect.width, b.rect.left + b.rect.width) - left,
        height: Math.max(a.rect.top + a.rect.height, b.rect.top + b.rect.height) - top,
      },
    };
  };
  return visit(tree).tree;
}

export function dockSplit(
  tree: CanvasSplit,
  source: string,
  edge: Edge,
  target?: string,
): CanvasSplit {
  const rects = splitRects(tree);
  if (
    !Object.hasOwn(rects, source) ||
    target === source ||
    (target && !Object.hasOwn(rects, target))
  )
    return tree;
  const rest = mapSplit(tree, (id) => (id === source ? null : id));
  if (!rest) return tree;
  return insertSplit(rest, source, edge, target);
}

/** Add new content at an edge without removing any existing pane. */
export function insertSplit(
  tree: CanvasSplit | null,
  source: string,
  edge: Edge,
  target?: string,
): CanvasSplit {
  if (!tree) return source;
  const rects = splitRects(tree);
  if (Object.hasOwn(rects, source)) return tree;
  const insert = (other: CanvasSplit): CanvasSplit => ({
    axis: edge === "left" || edge === "right" ? "columns" : "rows",
    ratio: 0.5,
    first: edge === "left" || edge === "top" ? source : other,
    second: edge === "left" || edge === "top" ? other : source,
  });
  return target && Object.hasOwn(rects, target)
    ? (mapSplit(tree, (id) => (id === target ? insert(id) : id)) ?? tree)
    : insert(tree);
}

export function dropEdge(
  x: number,
  y: number,
  width: number,
  height: number,
  band = 12,
): Edge | null {
  const distances: [Edge, number][] = [
    ["left", x / Math.min(band, width / 4)],
    ["right", (width - x) / Math.min(band, width / 4)],
    ["top", y / Math.min(band, height / 4)],
    ["bottom", (height - y) / Math.min(band, height / 4)],
  ];
  distances.sort((a, b) => a[1] - b[1]);
  return distances[0][1] <= 1 ? distances[0][0] : null;
}

export function paneGrid(
  tree: CanvasSplit | undefined,
  ids: readonly string[],
  aspect: number,
): CanvasGrid {
  const resolved = tree && reconcileSplit(tree, [], ids);
  if (!resolved) return tileLayout(ids.length, aspect);
  const rects = splitRects(resolved);
  const rounded = (value: number) => Math.round(value * 1e9) / 1e9;
  const lines = (position: "left" | "top", size: "width" | "height") =>
    [
      ...new Set(
        Object.values(rects).flatMap((rect) => [
          rounded(rect[position]),
          rounded(rect[position] + rect[size]),
        ]),
      ),
    ].sort((a, b) => a - b);
  const x = lines("left", "width");
  const y = lines("top", "height");
  const weights = {
    columns: x.slice(1).map((value, i) => value - x[i]),
    rows: y.slice(1).map((value, i) => value - y[i]),
  };
  const cells = ids.map((id) => {
    const rect = rects[id];
    const column = x.indexOf(rounded(rect.left));
    const row = y.indexOf(rounded(rect.top));
    return {
      column,
      row,
      span: x.indexOf(rounded(rect.left + rect.width)) - column,
      rowSpan: y.indexOf(rounded(rect.top + rect.height)) - row,
    };
  });
  if (cells.some((cell) => cell.span < 1 || cell.rowSpan < 1))
    return tileLayout(ids.length, aspect);
  return {
    columns: x.length - 1,
    rows: y.length - 1,
    cells,
    weights,
    key: JSON.stringify({ cells, weights }),
  };
}

/** Only expose separators along pane edges, never through a spanning pane. */
export function gridBoundaries(layout: CanvasGrid) {
  const result: { axis: Axis; boundary: number; start: number; end: number }[] = [];
  for (const axis of ["columns", "rows"] as const) {
    const segments = layout.cells
      .map((cell) =>
        axis === "columns"
          ? { axis, boundary: cell.column, start: cell.row, end: cell.row + cell.rowSpan }
          : { axis, boundary: cell.row, start: cell.column, end: cell.column + cell.span },
      )
      .filter((segment) => segment.boundary > 0)
      .sort((a, b) => a.boundary - b.boundary || a.start - b.start);
    for (const segment of segments) {
      const last = result.at(-1);
      if (
        axis === "rows" &&
        last &&
        last.axis === axis &&
        last.boundary === segment.boundary &&
        segment.start <= last.end
      )
        last.end = Math.max(last.end, segment.end);
      else result.push(segment);
    }
  }
  return result;
}

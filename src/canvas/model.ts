import type { MediaPlayback } from "../lib/media.ts";

export type CanvasFileView = "text" | "preview";

export type CanvasPane = { id: string; title?: string } & (
  | { kind: "empty" }
  | { kind: "iframe"; url: string }
  | { kind: "image"; src: string }
  | { kind: "file"; path: string; view?: CanvasFileView; playback?: MediaPlayback }
  | { kind: "video" | "audio"; src: string; playback?: MediaPlayback }
  | { kind: "code"; text: string; language?: string }
  | { kind: "markdown"; text: string }
);

export type TerminalCanvas = { id: string; revision: number; panes: CanvasPane[] };

export function paneSource(pane: CanvasPane): string {
  if (pane.kind === "file") return `file:${pane.path}:${pane.view ?? ""}`;
  return "src" in pane ? `${pane.kind}:${pane.src}` : pane.kind;
}

export function webAddress(raw: string, appOrigin: string): URL {
  const url = new URL(raw);
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username ||
    url.password ||
    url.origin === appOrigin ||
    ["tauri.localhost", "ipc.localhost"].includes(url.hostname)
  )
    throw new Error("Use an HTTP(S) page URL outside the application.");
  return url;
}

/** The last pane spans the remainder of its row: there are no unused cells. */
export function tileLayout(count: number, aspect = 1) {
  const columns = Math.max(1, Math.min(count, Math.round(Math.sqrt(count * aspect))));
  const rows = Math.max(1, Math.ceil(count / columns));
  return {
    columns,
    rows,
    cells: Array.from({ length: count }, (_, index) => ({
      column: index % columns,
      row: Math.floor(index / columns),
      span: index === count - 1 ? columns - (index % columns) : 1,
    })),
  };
}

export function adjacentPane(count: number, index: number, key: string, aspect = 1): number {
  const { cells } = tileLayout(count, aspect);
  const from = cells[index];
  if (!from) return 0;
  const horizontal = key === "ArrowLeft" || key === "ArrowRight";
  const sign = key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1;
  const x = from.column + from.span / 2;
  let best = index;
  let distance = Infinity;
  cells.forEach((cell, next) => {
    const dx = cell.column + cell.span / 2 - x;
    const dy = cell.row - from.row;
    const advance = (horizontal ? dx : dy) * sign;
    if (advance <= 0 || (horizontal && dy !== 0)) return;
    const away = horizontal ? 0 : Math.max(cell.column - x, x - cell.column - cell.span, 0);
    const score = advance * 100 + away;
    if (score < distance) {
      best = next;
      distance = score;
    }
  });
  return best;
}

export function insertFiles(
  panes: CanvasPane[],
  files: CanvasPane[],
  target?: string,
): CanvasPane[] {
  const at = panes.findIndex((pane) => pane.id === target);
  if (at < 0) return [...panes, ...files];
  return [
    ...panes.slice(0, at + (panes[at].kind === "empty" ? 0 : 1)),
    ...files,
    ...panes.slice(at + 1),
  ];
}

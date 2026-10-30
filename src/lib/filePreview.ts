import { type SelectionEntry, topLevelEntries } from "./fileSelection.ts";

export const FILE_DRAG_TYPE = "application/x-totex-file";
export const FILES_DRAG_TYPE = "application/x-totex-files";

export function hasFileDrag(transfer: Pick<DataTransfer, "types">): boolean {
  return transfer.types.includes(FILES_DRAG_TYPE) || transfer.types.includes(FILE_DRAG_TYPE);
}

export function writeFileDrag(transfer: DataTransfer, entries: readonly SelectionEntry[]): void {
  const picked = topLevelEntries(entries);
  transfer.effectAllowed = "copy";
  transfer.setData(
    FILES_DRAG_TYPE,
    JSON.stringify(picked.map(({ path, isDir }) => ({ path, isDir }))),
  );
  if (picked.length === 1 && !picked[0].isDir) transfer.setData(FILE_DRAG_TYPE, picked[0].path);
  transfer.setData("text/plain", picked.map((entry) => entry.path).join("\n"));
}

export function readFileDrag(transfer: Pick<DataTransfer, "getData">): SelectionEntry[] {
  const multiple = transfer.getData(FILES_DRAG_TYPE);
  if (multiple) {
    try {
      const entries: unknown = JSON.parse(multiple);
      if (
        !Array.isArray(entries) ||
        !entries.every(
          (entry) =>
            entry !== null &&
            typeof entry === "object" &&
            typeof entry.path === "string" &&
            entry.path.length > 0 &&
            typeof entry.isDir === "boolean",
        )
      )
        return [];
      return topLevelEntries(entries.map(({ path, isDir }) => ({ path, isDir })));
    } catch {
      return [];
    }
  }
  const path = transfer.getData(FILE_DRAG_TYPE);
  return path ? [{ path, isDir: false }] : [];
}

export type FilePreviewView =
  | "text"
  | "diff"
  | "markdown"
  | "picture"
  | "settings"
  | "pdf"
  | "dxf"
  | "video"
  | "audio"
  | "html"
  | "table"
  | "model"
  | "epub";

export type FilePreviewRequest = {
  id: number;
  path: string;
  at: { x: number; y: number } | null;
  view?: FilePreviewView;
  /** Placed beside the card it was opened from — see `useFilePreviewPlacing`. */
  beside?: number;
  pinned?: {
    at: { x: number; y: number };
    scale: number;
    box: { width: number; height: number };
    collapsed: boolean;
  };
};

// Nothing is decoded here: a format is listed exactly when the engine draws it from raw bytes.
const PICTURES: Record<string, string> = {
  ".png": "image/png",
  ".apng": "image/apng",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".jfif": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".bmp": "image/bmp",
  ".ico": "image/x-icon",
  ".avif": "image/avif",
  ".svg": "image/svg+xml",
};

const WRITTEN = /\.(md|markdown|mdx|svg|html|htm|csv|tsv)$/i;

const MEDIA: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".webm": "video/webm",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".aac": "audio/aac",
  ".ogg": "audio/ogg",
  ".oga": "audio/ogg",
  ".opus": "audio/ogg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
};

export function mediaType(path: string): string | null {
  return MEDIA[path.slice(path.lastIndexOf(".")).toLowerCase()] ?? null;
}

export function mediaView(path: string): "audio" | "video" | null {
  const type = mediaType(path);
  return type === null ? null : type.startsWith("video/") ? "video" : "audio";
}

export function pictureType(path: string): string | null {
  const dot = path.lastIndexOf(".");
  return dot < 0 ? null : (PICTURES[path.slice(dot).toLowerCase()] ?? null);
}

export function vector(path: string): boolean {
  return pictureType(path) === "image/svg+xml";
}

export function previewable(path: string): boolean {
  return WRITTEN.test(path) || documentView(path) !== null || mediaView(path) !== null;
}

export function previewView(path: string): FilePreviewView {
  return (
    documentView(path) ??
    mediaView(path) ??
    (/\.(csv|tsv)$/i.test(path)
      ? "table"
      : /\.html?$/i.test(path)
        ? "html"
        : pictureType(path) === null
          ? "markdown"
          : "picture")
  );
}

export function openingView(path: string): FilePreviewView {
  return (
    documentView(path) ??
    mediaView(path) ??
    (/\.(csv|tsv)$/i.test(path)
      ? "table"
      : pictureType(path) !== null && !previewable(path)
        ? "picture"
        : "text")
  );
}

/** A drawing of the file: nothing to type into, no patch, no preview to open. */
export function drawn(view: FilePreviewView): boolean {
  return (
    view === "markdown" ||
    view === "picture" ||
    view === "settings" ||
    view === "pdf" ||
    view === "dxf" ||
    view === "video" ||
    view === "audio" ||
    view === "html" ||
    view === "table" ||
    view === "model" ||
    view === "epub"
  );
}

/** The settings page is one file card outside the request sequence. */
export const SETTINGS_REQUEST_ID = -1;

export function documentView(path: string): "pdf" | "dxf" | "model" | "epub" | null {
  if (/\.pdf$/i.test(path)) return "pdf";
  if (/\.dxf$/i.test(path)) return "dxf";
  if (/\.(gltf|glb|stl|obj)$/i.test(path)) return "model";
  if (/\.epub$/i.test(path)) return "epub";
  return null;
}

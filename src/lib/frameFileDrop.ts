import { readFile } from "../folder/api";
import { baseName } from "../folder/format";
import { mediaType, pictureType } from "./filePreview";

const DOCUMENT_TYPES: Record<string, string> = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".csv": "text/csv",
  ".tsv": "text/tab-separated-values",
  ".json": "application/json",
  ".pdf": "application/pdf",
  ".html": "text/html",
  ".htm": "text/html",
  ".css": "text/css",
  ".js": "text/javascript",
  ".xml": "application/xml",
  ".zip": "application/zip",
  ".gz": "application/gzip",
  ".epub": "application/epub+zip",
  ".doc": "application/msword",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".xls": "application/vnd.ms-excel",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".ppt": "application/vnd.ms-powerpoint",
  ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
};

/** Tauri owns Windows file drops; only explicitly dropped files cross into the served page. */
export async function dropFilesOnFrame(
  frame: HTMLIFrameElement,
  paths: readonly string[],
  at: { x: number; y: number },
): Promise<void> {
  if (!paths.length || !Number.isFinite(at.x) || !Number.isFinite(at.y)) return;
  const source = { src: frame.getAttribute("src"), srcdoc: frame.getAttribute("srcdoc") };
  const receiver = frame.contentWindow;
  const visible = () =>
    frame.isConnected &&
    !frame.closest("[hidden], [inert]") &&
    getComputedStyle(frame).visibility === "visible" &&
    document.elementFromPoint(at.x, at.y) === frame;
  if (!receiver || !visible()) return;
  const bounds = frame.getBoundingClientRect();
  if (!bounds.width || !bounds.height || !frame.offsetWidth || !frame.offsetHeight) return;
  const x = ((at.x - bounds.left) * frame.offsetWidth) / bounds.width - frame.clientLeft;
  const y = ((at.y - bounds.top) * frame.offsetHeight) / bounds.height - frame.clientTop;
  if (x < 0 || y < 0 || x >= frame.clientWidth || y >= frame.clientHeight) return;

  const files = await Promise.all(
    paths.map(async (path) => {
      const bytes = await readFile(path);
      const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
      const type = pictureType(path) ?? mediaType(path) ?? DOCUMENT_TYPES[extension] ?? "";
      return new File([Uint8Array.from(bytes)], baseName(path), { type });
    }),
  );
  if (
    !visible() ||
    receiver !== frame.contentWindow ||
    source.src !== frame.getAttribute("src") ||
    source.srcdoc !== frame.getAttribute("srcdoc")
  )
    return;
  // LiveFrame's first hop is our same-origin srcdoc wrapper, never an arbitrary page origin.
  receiver.postMessage({ type: "totex:frame-file-drop", x, y, files }, location.origin);
}

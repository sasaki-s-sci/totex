import { invoke } from "@tauri-apps/api/core";
import { hasFileDrag, readFileDrag } from "./filePreview.ts";

/** Quote paths as single arguments without submitting a command. PowerShell is the Windows shell. */
export function quotePaths(paths: readonly string[], windows: boolean): string {
  return paths
    .map((path) => {
      // biome-ignore lint/suspicious/noControlCharactersInRegex: terminal control bytes must never come from a filename
      if (!path || /[\x00-\x1f\x7f]/.test(path)) throw new Error("invalid-path");
      return /^[a-zA-Z0-9_./:@+-]+$/.test(path)
        ? path
        : `'${path.replaceAll("'", windows ? "''" : "'\\''")}'`;
    })
    .join(" ");
}

export async function terminalPaths(paths: readonly string[], cwd: string): Promise<string> {
  const native = await invoke<string[]>("terminal_paths", { paths, cwd });
  return quotePaths(native, /^[a-z]:[\\/]|^\\\\(?!wsl[.$])/i.test(cwd));
}

const targets = new Map<HTMLElement, (paths: readonly string[]) => void>();

export function terminalUnder(x: number, y: number): HTMLElement | null {
  let element = document.elementFromPoint(x, y);
  while (element) {
    if (targets.has(element as HTMLElement)) return element as HTMLElement;
    element = element.parentElement;
  }
  return null;
}

export function dropOnTerminal(target: HTMLElement, paths: readonly string[]): void {
  targets.get(target)?.(paths);
}

export function registerTerminalDrop(
  element: HTMLElement,
  paste: (paths: readonly string[]) => void,
) {
  const target = element.closest<HTMLElement>(".page") ?? element;
  targets.set(target, paste);
  const over = (event: DragEvent) => {
    if (!event.dataTransfer || !hasFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "copy";
  };
  const drop = (event: DragEvent) => {
    if (!event.dataTransfer || !hasFileDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    const paths = readFileDrag(event.dataTransfer).map((entry) => entry.path);
    if (paths.length) paste(paths);
  };
  target.addEventListener("dragover", over);
  target.addEventListener("drop", drop);
  return () => {
    targets.delete(target);
    target.removeEventListener("dragover", over);
    target.removeEventListener("drop", drop);
  };
}

import { invoke } from "@tauri-apps/api/core";

/** Where a root comes from. Each host only produces some of these. */
export type RootKind = "home" | "windows-drive" | "wsl-distro" | "unix-root" | "windows-mount";

export interface Root {
  kind: RootKind;
  label: string;
  path: string;
  detail: string | null;
}

export interface FsEntry {
  name: string;
  path: string;
  isDir: boolean;
  isSymlink: boolean;
  isHidden: boolean;
  size: number | null;
  modifiedMs: number | null;
}

export interface Listing {
  path: string;
  name: string;
  parent: string | null;
  entries: FsEntry[];
  truncated: boolean;
}

/** The bounded part of a file that a preview card can safely draw. */
export interface FileHead {
  path: string;
  name: string;
  text: string | null;
  size: number;
  truncated: boolean;
}

/** Carries the directories whose contents just moved, as absolute paths. */
export const FS_CHANGED_EVENT = "fs:changed";

export function listRoots(): Promise<Root[]> {
  return invoke<Root[]>("list_roots");
}

export function readDirectory(path: string, showHidden: boolean): Promise<Listing> {
  return invoke<Listing>("read_directory", { path, showHidden });
}

export function readFileHead(path: string): Promise<FileHead> {
  return invoke<FileHead>("read_file_head", { path });
}

/**
 * Writes an edited card back to its file, and answers with how long it now is.
 *
 * `expectSize` is how long the file was when the card read it: the backend
 * refuses a file that is no longer that long, because something else wrote it
 * in the meantime and that write is what this one would drop.
 */
export function writeFile(path: string, text: string, expectSize: number): Promise<number> {
  return invoke<number>("write_file", { path, text, expectSize });
}

/**
 * How many repositories each of these folders holds — itself, or under it.
 *
 * The number on the graph mark. Every folder can be put on the graph, so this
 * says what is in one rather than whether it is worth offering. Asked one
 * listing at a time, because the folders in a listing can be walked in
 * parallel; only the ones holding any are answered for.
 */
export function repositoryCounts(paths: string[]): Promise<Record<string, number>> {
  return invoke<Record<string, number>>("repository_counts", { paths });
}

/**
 * Watches exactly these directories, and stops watching everything else.
 *
 * The whole set every time rather than one path at a time: the panes know what
 * they are showing, and that is the only thing the watch has to agree with.
 */
export function watchDirectories(paths: string[]): Promise<void> {
  return invoke<void>("watch_directories", { paths });
}

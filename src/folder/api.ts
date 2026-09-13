import { invoke } from "@tauri-apps/api/core";

export type RootKind = "home" | "windows-drive" | "wsl-distro" | "unix-root" | "windows-mount";

export interface Root {
  kind: RootKind;
  label: string;
  path: string;
  detail: string | null;
}

/** A place kept because a person typed it, as opposed to a `Root` the machine has. */
export interface Place {
  path: string;
  label: string;
  display: string;
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
  /**
   * The WSL distribution the directory is inside, or null: the same path in two distributions is
   * two places.
   */
  distro: string | null;
  entries: FsEntry[];
  truncated: boolean;
}

export interface FileHead {
  path: string;
  name: string;
  text: string | null;
  size: number;
  truncated: boolean;
}

export interface FileData {
  path: string;
  name: string;
  /** Base64, or null when too large for a card to draw. */
  data: string | null;
  size: number;
}

export const FS_CHANGED_EVENT = "fs:changed";

export function listRoots(): Promise<Root[]> {
  return invoke<Root[]>("list_roots");
}

/** `~` expanded and `..` folded; a file or a missing path is a failure. */
export function resolveFolder(path: string): Promise<Place> {
  return invoke<Place>("resolve_folder", { path });
}

/** Reads no disk, so the menu can be drawn from it each time it opens. */
export function describeFolders(paths: string[]): Promise<Place[]> {
  return invoke<Place[]>("describe_folders", { paths });
}

export function readDirectory(path: string, showHidden: boolean): Promise<Listing> {
  return invoke<Listing>("read_directory", { path, showHidden });
}

export function readFileHead(path: string): Promise<FileHead> {
  return invoke<FileHead>("read_file_head", { path });
}

export function readFileData(path: string): Promise<FileData> {
  return invoke<FileData>("read_file_data", { path });
}

/**
 * `expectSize` is what the card read; the backend refuses a file whose length has changed since.
 */
export function writeFile(path: string, text: string, expectSize: number): Promise<number> {
  return invoke<number>("write_file", { path, text, expectSize });
}

export function readFile(path: string): Promise<number[]> {
  return invoke<number[]>("fs_read_file", { path });
}

export function createEntry(parent: string, name: string, directory: boolean): Promise<string> {
  return invoke<string>("fs_create_entry", { parent, name, directory });
}

export function duplicateFile(path: string): Promise<string> {
  return invoke<string>("fs_duplicate_file", { path });
}

export function renameFile(path: string, name: string): Promise<string> {
  return invoke<string>("fs_rename_file", { path, name });
}

export function deleteFile(path: string): Promise<void> {
  return invoke<void>("fs_delete_file", { path });
}

/** Told apart from a file's removal at both ends. A link to a folder loses the link alone. */
export function deleteFolder(path: string): Promise<void> {
  return invoke<void>("fs_delete_folder", { path });
}

/** Lands in the host's downloads folder even for a WSL path. */
export function downloadEntry(path: string): Promise<string> {
  return invoke<string>("fs_download", { path });
}

/** Always a copy; a taken name gets the `copy` spelling. Either end may be inside WSL. */
export function copyInto(paths: string[], into: string): Promise<string[]> {
  return invoke<string[]>("fs_copy_into", { paths, into });
}

/** Asked one listing at a time; only folders holding any are answered for. */
export function repositoryCounts(paths: string[]): Promise<Record<string, number>> {
  return invoke<Record<string, number>>("repository_counts", { paths });
}

export type Change = "added" | "modified" | "deleted";

export interface Answer {
  changed: Record<string, Change>;
  ignored: string[];
  /** An ignored directory lists nothing: everything under it is ignored too. */
  allIgnored: boolean;
}

/**
 * Keyed by directory, then entry; a folder entry carries everything under it. Directories git will
 * not answer for are left out.
 */
export function directoryChanges(paths: string[]): Promise<Record<string, Answer>> {
  return invoke<Record<string, Answer>>("directory_changes", { paths });
}

/** `same` also covers an ignored file. */
export type Standing = "unknown" | "same" | "changed" | "untracked";

/**
 * Runs, not lines: the gutter draws bars. A deletion covers no lines and stands at the gap above
 * `line`.
 */
export interface DiffRun {
  line: number;
  lines: number;
  mark: Change;
}

export interface FileDiff {
  standing: Standing;
  patch: string;
  truncated: boolean;
  runs: DiffRun[];
}

/** Never a failure: a file outside a repository comes back `unknown`. */
export function fileDiff(path: string): Promise<FileDiff> {
  return invoke<FileDiff>("file_diff", { path });
}

/** The whole set every time: the panes are the only thing the watch has to agree with. */
export function watchDirectories(paths: string[]): Promise<void> {
  return invoke<void>("watch_directories", { paths });
}

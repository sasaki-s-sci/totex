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
  /**
   * The WSL distribution the directory is inside, or `null` for this machine.
   *
   * A path inside one is read and worked on inside it rather than through the
   * share Windows publishes it under, so `/home/a/repo` in one distribution and
   * the same name in another are two places. This is what says which.
   */
  distro: string | null;
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
 * What became of a file, as far as a row in the column can show it.
 *
 * Green for what has arrived, orange for what has been rewritten, red for what
 * has gone — the three the graph's rims are drawn in, said here one file at a
 * time.
 */
export type Change = "added" | "modified" | "deleted";

/**
 * What is uncommitted in each of these directories, by the row it belongs to.
 *
 * Keyed by the directory asked about, then by the name of an entry in it. An
 * entry that is a folder carries what everything underneath it comes to, so a
 * change three levels down colours the one row in this listing that leads to
 * it — and a directory git will not answer for, which is most of a machine, is
 * left out rather than failing the call.
 *
 * All of them in one crossing, because they are asked for on a clock: see
 * `changes.ts`, which is the only caller.
 */
export function directoryChanges(paths: string[]): Promise<Record<string, Record<string, Change>>> {
  return invoke<Record<string, Record<string, Change>>>("directory_changes", { paths });
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

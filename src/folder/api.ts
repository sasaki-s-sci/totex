import { invoke } from "@tauri-apps/api/core";

/** Where a root comes from. Each host only produces some of these. */
export type RootKind = "home" | "windows-drive" | "wsl-distro" | "unix-root" | "windows-mount";

export interface Root {
  kind: RootKind;
  label: string;
  path: string;
  detail: string | null;
}

/**
 * A folder someone typed and kept, spelled out for the row that offers it.
 *
 * Not a `Root`: those are what the machine has, and there is nothing to keep
 * about them. This is the other kind — a place that exists because a person
 * named it, which between two windows is only ever a path.
 */
export interface Place {
  /** What a pane is started at: folded, and spelled as every path here is. */
  path: string;
  /** The folder's own name, which is what the row is read by. */
  label: string;
  /** The whole path with the home directory written `~`, for the line under
   *  the name. */
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

/**
 * Settles one typed path into a folder to keep, or refuses it.
 *
 * `~` is expanded and `..` folded, so what can be typed is what a shell takes.
 * A path that is a file, or nothing at all, comes back as a failure: a folder
 * is refused where it was typed rather than kept and left to fail at the pane
 * that could not open it.
 */
export function resolveFolder(path: string): Promise<Place> {
  return invoke<Place>("resolve_folder", { path });
}

/** Spells out the folders that were kept, which are stored as paths alone.
 *  Reads no disk, so a menu can be drawn from it every time it opens. */
export function describeFolders(paths: string[]): Promise<Place[]> {
  return invoke<Place[]>("describe_folders", { paths });
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

/** Reads a complete file for an explicit clipboard copy or download. */
export function readFile(path: string): Promise<number[]> {
  return invoke<number[]>("fs_read_file", { path });
}

/** Creates one empty file or folder directly inside `parent`. */
export function createEntry(parent: string, name: string, directory: boolean): Promise<string> {
  return invoke<string>("fs_create_entry", { parent, name, directory });
}

/** Copies a file beside itself and returns the unused name chosen for it. */
export function duplicateFile(path: string): Promise<string> {
  return invoke<string>("fs_duplicate_file", { path });
}

/** Renames one file in place and returns its new full path. */
export function renameFile(path: string, name: string): Promise<string> {
  return invoke<string>("fs_rename_file", { path, name });
}

export function deleteFile(path: string): Promise<void> {
  return invoke<void>("fs_delete_file", { path });
}

/**
 * Removes one folder and everything under it.
 *
 * Asked for by a name of its own rather than by handing a folder to the call
 * above: what a file's removal takes away is the file, and what this takes away
 * is a tree nobody can see the end of from the row they right-clicked. So the
 * two are told apart here, in the dialog that asks, and again in the layer that
 * answers — each refuses what the other is for.
 *
 * A link to a folder loses the link alone: what it pointed at stays where it is.
 */
export function deleteFolder(path: string): Promise<void> {
  return invoke<void>("fs_delete_folder", { path });
}

/**
 * Puts a copy of one file or folder where this machine keeps its downloads,
 * and answers with where it went.
 *
 * Where the window is running, not where the file is: a path inside a WSL
 * distribution lands in the host's own downloads folder, which is the one place
 * every other program on that machine can open it from. The whole of a folder
 * comes with it.
 */
export function downloadEntry(path: string): Promise<string> {
  return invoke<string>("fs_download", { path });
}

/**
 * Copies everything in `paths` into the folder `into`, and answers with where
 * each of them landed.
 *
 * What a drop on a folder is, and it is a copy every time: what was dropped
 * stays where it was, and a name the folder is already using is given the same
 * `copy` spelling a duplicate gets rather than being written over. Either end
 * can be inside a WSL distribution — something dragged out of Explorer onto a
 * folder in one is the ordinary case, and the copy is made inside the
 * distribution so that what lands there belongs to the account working in it.
 */
export function copyInto(paths: string[], into: string): Promise<string[]> {
  return invoke<string[]>("fs_copy_into", { paths, into });
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
 * What git has to say about the rows of one directory.
 *
 * Two things, and a row is drawn by one or the other: what became of a file is
 * a colour, and being on the ignore list is a faint row. `node_modules`, a
 * `dist`, a log — on the disk, in the listing, and no part of what the
 * repository is.
 */
export interface Answer {
  /** What became of each row that has moved, by the name of that row. */
  changed: Record<string, Change>;
  /** The rows of this directory git was told to ignore, by name. */
  ignored: string[];
  /**
   * True when the directory itself is one of those, which makes every row in
   * it one too. Nothing is listed then: there is nothing in such a directory
   * that is not on the list, and naming what is under `node_modules` one file
   * at a time is what this avoids.
   */
  allIgnored: boolean;
}

/**
 * What git says about each of these directories, by the row it belongs to.
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
export function directoryChanges(paths: string[]): Promise<Record<string, Answer>> {
  return invoke<Record<string, Answer>>("directory_changes", { paths });
}

/**
 * Where a file stands with the repository around it, as far as one is watching.
 *
 * `same` covers a file git was told to ignore as well as one the commit under
 * it agrees with: neither has anything for a card to draw.
 */
export type Standing = "unknown" | "same" | "changed" | "untracked";

/**
 * One run of lines of the file as it now stands, and what became of them.
 *
 * Runs rather than lines, because the gutter is drawn in bars: a hundred
 * changed lines in a row is one bar. A deletion covers no lines at all —
 * nothing of it is left in the file — and stands at the gap above `line`.
 */
export interface DiffRun {
  line: number;
  lines: number;
  mark: Change;
}

/** What git has to say about the one file a card is holding. */
export interface FileDiff {
  standing: Standing;
  /** The hunks as git printed them, with the header naming the file taken off. */
  patch: string;
  /** The patch ran past what a card is given and was cut short. */
  truncated: boolean;
  runs: DiffRun[];
}

/**
 * What became of one file since the commit under it.
 *
 * Never a failure: a file outside a repository is the ordinary case here — the
 * canvas opens files from anywhere — and comes back as `unknown` rather than as
 * an error.
 */
export function fileDiff(path: string): Promise<FileDiff> {
  return invoke<FileDiff>("file_diff", { path });
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

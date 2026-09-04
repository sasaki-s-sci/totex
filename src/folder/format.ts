/** Last segment of a path, for both `C:\dir`, `\\wsl.localhost\Ubuntu` and `/dir`.
 *  Roots such as `/` or `C:\` keep their full spelling because they have none. */
export function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const name = cut >= 0 ? trimmed.slice(cut + 1) : trimmed;
  return name || path;
}

/** The folder a path is in, or null for a root, which is in none. Spelled the
 *  way the path was: what git is asked about a file is asked in this. */
export function folderOf(path: string): string | null {
  const trimmed = path.replace(/[\\/]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (cut < 0) return null;
  // A path whose only separator is the leading one is inside the root itself.
  return trimmed.slice(0, cut) || trimmed.slice(0, cut + 1);
}

/** Whether `path` is the folder `parent` or something under it. Both are
 *  spelled the way the listing they came from spells them, so the separators
 *  are taken as they are rather than settled first. */
export function isInside(parent: string, path: string): boolean {
  const bare = parent.replace(/[\\/]+$/, "");
  return path === bare || path.startsWith(`${bare}/`) || path.startsWith(`${bare}\\`);
}

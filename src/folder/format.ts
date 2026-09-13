/** Forward slashes for display; filesystem paths stay as they are. */
export function displayPath(path: string): string {
  return path.replaceAll("\\", "/");
}

/** Roots such as `/` or `C:\\` keep their full spelling. */
export function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const name = cut >= 0 ? trimmed.slice(cut + 1) : trimmed;
  return name || path;
}

/** Spelled the way the path was: git is asked about a file in this. */
export function folderOf(path: string): string | null {
  const trimmed = path.replace(/[\\/]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  if (cut < 0) return null;
  // A path whose only separator is the leading one is inside the root itself.
  return trimmed.slice(0, cut) || trimmed.slice(0, cut + 1);
}

/** Separators are taken as they are, not settled first. */
export function isInside(parent: string, path: string): boolean {
  const bare = parent.replace(/[\\/]+$/, "");
  return path === bare || path.startsWith(`${bare}/`) || path.startsWith(`${bare}\\`);
}

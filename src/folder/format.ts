/** Forward slashes for display; filesystem paths stay as they are. */
export function displayPath(path: string): string {
  return path.replaceAll("\\", "/");
}

/**
 * `ssh://box/` at the front of a path on that host: the slashes in it are spelling, not steps.
 * The root itself may be written without its trailing slash.
 */
const REMOTE_ROOT = /^ssh:\/\/[^\\/]+\/?/;

/** Everything after the remote root, or the whole path when it is on this machine. */
function split(path: string): { root: string; rest: string } {
  const root = path.match(REMOTE_ROOT)?.[0] ?? "";
  return { root, rest: path.slice(root.length) };
}

/** Roots such as `/`, `C:\\` or `ssh://box/` keep their full spelling. */
export function baseName(path: string): string {
  const { rest } = split(path);
  const trimmed = rest.replace(/[\\/]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const name = cut >= 0 ? trimmed.slice(cut + 1) : trimmed;
  return name || path;
}

/** Spelled the way the path was: git is asked about a file in this. */
export function folderOf(path: string): string | null {
  const { root, rest } = split(path);
  const trimmed = rest.replace(/[\\/]+$/, "");
  if (root) {
    // The remote root has no folder; a name straight under it is inside the root itself.
    if (!trimmed) return null;
    const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
    return cut < 0 ? root : root + trimmed.slice(0, cut);
  }
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

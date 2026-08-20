/** Last segment of a path, for both `C:\dir`, `\\wsl.localhost\Ubuntu` and `/dir`.
 *  Roots such as `/` or `C:\` keep their full spelling because they have none. */
export function baseName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, "");
  const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  const name = cut >= 0 ? trimmed.slice(cut + 1) : trimmed;
  return name || path;
}

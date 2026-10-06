/** Where a link or picture in a markdown file points, read the way a markdown viewer reads it. */
export type Target =
  | { kind: "anchor"; name: string }
  | { kind: "web"; url: string }
  | { kind: "file"; path: string };

const DRIVE = /^[A-Za-z]:[\\/]/;
const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;

/** Where a link goes; `null` for a scheme nothing here can open. */
export function linkTarget(href: string, from: string): Target | null {
  const ref = href.trim();
  if (!ref) return null;
  if (ref.startsWith("#")) return { kind: "anchor", name: decoded(ref.slice(1)) };
  const web = webUrl(ref);
  if (web) return { kind: "web", url: web };
  if (/^mailto:/i.test(ref)) return { kind: "web", url: ref };
  const path = filePath(ref, from);
  return path === null ? null : { kind: "file", path };
}

/** Where a picture is read from; `null` for one that cannot be drawn. */
export function pictureTarget(src: string, from: string): Target | null {
  const ref = src.trim();
  if (!ref || ref.startsWith("#")) return null;
  if (/^data:image\//i.test(ref)) return { kind: "web", url: ref };
  const web = webUrl(ref);
  if (web) return { kind: "web", url: web };
  const path = filePath(ref, from);
  return path === null ? null : { kind: "file", path };
}

function webUrl(ref: string): string | null {
  // Protocol-relative, as GitHub reads it.
  const spelled = ref.startsWith("//") ? `https:${ref}` : ref;
  if (!/^https?:\/\//i.test(spelled)) return null;
  try {
    return new URL(spelled).href;
  } catch {
    return null;
  }
}

/** A path on the same machine as `from`, the markdown file; the query and fragment are dropped. */
export function filePath(ref: string, from: string): string | null {
  let bare = ref;
  if (/^file:/i.test(bare)) {
    try {
      const url = new URL(bare);
      bare = decoded(url.pathname);
      // `file:///C:/x` is spelled with a slash before the drive.
      if (/^\/[A-Za-z]:\//.test(bare)) bare = bare.slice(1);
    } catch {
      return null;
    }
  } else {
    if (SCHEME.test(bare) && !DRIVE.test(bare)) return null;
    bare = decoded(bare.replace(/[?#].*$/, ""));
  }
  if (!bare) return null;
  if (DRIVE.test(bare) || bare.startsWith("\\\\")) return settled(bare);

  const base = rootOf(from);
  if (/^[\\/]/.test(bare)) return settled(base.root + bare.replace(/^[\\/]+/, ""));
  const cut = Math.max(from.lastIndexOf("/"), from.lastIndexOf("\\"));
  const folder = cut < base.root.length ? base.root : from.slice(0, cut + 1);
  return settled(folder + bare);
}

/** `ssh://box/`, `C:\`, `\\server\share\` or `/`: what `..` never climbs past. */
function rootOf(path: string): { root: string; separator: "/" | "\\" } {
  const remote = path.match(/^ssh:\/\/[^\\/]+\//)?.[0];
  if (remote) return { root: remote, separator: "/" };
  const drive = path.match(DRIVE)?.[0];
  if (drive) return { root: `${drive.slice(0, 2)}\\`, separator: "\\" };
  const share = path.match(/^\\\\[^\\/]+[\\/][^\\/]+[\\/]?/)?.[0];
  if (share)
    return { root: `${share.replace(/[\\/]?$/, "").replaceAll("/", "\\")}\\`, separator: "\\" };
  return { root: path.startsWith("/") ? "/" : "", separator: "/" };
}

/** `.` and `..` folded, and the separators spelled the way the root spells them. */
function settled(path: string): string {
  const { root, separator } = rootOf(path);
  const steps: string[] = [];
  for (const step of path.slice(root.length).split(/[\\/]+/)) {
    if (step === "" || step === ".") continue;
    if (step === "..") steps.pop();
    else steps.push(step);
  }
  return root + steps.join(separator);
}

function decoded(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/** The anchor GitHub gives a heading: lower case, punctuation dropped, spaces as hyphens. */
export function slugOf(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, "")
    .replace(/ /g, "-");
}

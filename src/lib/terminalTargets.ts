import type { Terminal } from "@xterm/xterm";
import { webAddress } from "../canvas/model.ts";
import { filePath } from "../canvas/nodes/preview/markdownTargets.ts";

export type TerminalTarget = { kind: "url" | "file"; value: string };

const DRIVE = /^[a-z]:[\\/]/i;
const REMOTE = /^ssh:\/\/[^/\\\s]+(?:\/|$)/;
const WSL = /^\\\\wsl[.$][^\\/]*[\\/][^\\/]+(?:[\\/]|$)/i;
// biome-ignore lint/suspicious/noControlCharactersInRegex: terminal control bytes never belong to a URL or filename
const CONTROL = /[\x00-\x1f\x7f]/;

/** Terminal filenames are literal; only file: URLs decode escapes or drop a fragment. */
export function terminalTarget(
  text: string,
  cwd: string,
  appOrigin: string,
): TerminalTarget | null {
  if (CONTROL.test(text)) return null;
  let value = text.trim();
  for (const [left, right] of [
    ['"', '"'],
    ["'", "'"],
    ["`", "`"],
    ["(", ")"],
    ["[", "]"],
    ["<", ">"],
  ]) {
    if (value.startsWith(left) && value.endsWith(right)) value = value.slice(1, -1);
  }
  if (!value) return null;
  if (/^https?:/i.test(value)) {
    try {
      return { kind: "url", value: webAddress(value, appOrigin).href };
    } catch {
      return null;
    }
  }
  value = value.replace(/:\d+(?::\d+)?$/, "");
  if (/^file:/i.test(value)) {
    try {
      const url = new URL(value);
      value = decodeURIComponent(url.pathname).replace(/^\/(?=[a-z]:\/)/i, "");
      if (url.hostname && url.hostname !== "localhost" && !REMOTE.test(cwd) && !WSL.test(cwd))
        value = `\\\\${url.hostname}${value.replaceAll("/", "\\")}`;
    } catch {
      return null;
    }
  }
  if (!value || CONTROL.test(value)) return null;
  const remote = value.match(REMOTE)?.[0];
  if (remote) {
    const inside = value.slice(remote.length);
    if (inside.startsWith("~/")) return { kind: "file", value };
    const path = filePath(encodeURIComponent(inside), `${remote}_`);
    return path ? { kind: "file", value: path } : null;
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) && !DRIVE.test(value)) return null;
  if (!/[\\/]/.test(value) && !/^(?:\.[^\s.]+|[^.]+\.[^\s.]+)$/.test(value)) return null;
  const from = `${cwd.replace(/[\\/]+$/, "")}/_`;
  if (/^~[\\/]/.test(value)) {
    const root = REMOTE.test(cwd) || WSL.test(cwd) ? filePath("/", from) : "";
    return { kind: "file", value: `${root ?? ""}${value}` };
  }
  // Reuse host-aware resolution without Markdown's percent/query/fragment interpretation.
  const path = filePath(encodeURIComponent(value), from);
  return path ? { kind: "file", value: path } : null;
}

/** Read public xterm buffer cells so wrapped lines and wide characters keep their positions. */
export function terminalTextAt(terminal: Terminal, x: number, y: number): string | null {
  const screen = terminal.element?.querySelector(".xterm-screen")?.getBoundingClientRect();
  if (!screen || x < screen.left || x >= screen.right || y < screen.top || y >= screen.bottom)
    return null;
  let column = Math.floor(((x - screen.left) / screen.width) * terminal.cols);
  const row =
    terminal.buffer.active.viewportY +
    Math.floor(((y - screen.top) / screen.height) * terminal.rows);
  const buffer = terminal.buffer.active;
  if (buffer.getLine(row)?.getCell(column)?.getWidth() === 0) column -= 1;
  let start = row;
  while (start > 0 && buffer.getLine(start)?.isWrapped) start -= 1;
  let text = "";
  let offset = 0;
  for (let at = start; at < buffer.length; at += 1) {
    const line = buffer.getLine(at);
    if (!line || (at > start && !line.isWrapped)) break;
    if (at === row) offset = text.length + line.translateToString(false, 0, column).length;
    let end = line.length;
    while (end > 0 && !line.getCell(end - 1)?.getChars()) end -= 1;
    text += line.translateToString(false, 0, end);
  }
  for (const match of text.matchAll(/"[^"]+"|'[^']+'|`[^`]+`|\S+/g)) {
    if (offset >= match.index && offset < match.index + match[0].length)
      return match[0].replace(/[.,;]+$/, "");
  }
  return null;
}

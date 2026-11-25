import { invoke } from "@tauri-apps/api/core";
import type { Terminal } from "@xterm/xterm";
import { useSyncExternalStore } from "react";
import { webAddress } from "../canvas/model";
import { type CanvasPage, pageCommand, pageUrls, readPages, rememberPages } from "../canvas/pages";
import type { Glance } from "../monitor/model";
import { frontValue, keepFrontValue } from "../shell/state";
import { notifications } from "./notifications";
import type { Session } from "./session";

const changes = notifications();
let pages: CanvasPage[] | undefined;
// Startup restores carried state after modules load, before the first render.
const currentPages = () => (pages ??= readPages(frontValue("canvas.pages"), location.origin));

export function useTerminalPages(): readonly CanvasPage[] {
  return useSyncExternalStore(changes.subscribe, currentPages);
}

export function registerTerminalPages(terminal: Terminal, session: Session) {
  let live = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  // Retained output cannot be attributed to the command running now.
  const seen = new Map(
    [terminal.buffer.normal, terminal.buffer.alternate].map((buffer) => [
      buffer.type,
      pageUrls(buffer, location.origin),
    ]),
  );
  const linked = new Set<string>();
  const collect = async () => {
    timer = undefined;
    const buffer = terminal.buffer.active;
    const urls = pageUrls(buffer, location.origin);
    const previous = seen.get(buffer.type);
    const added = new Set(linked);
    linked.clear();
    // shortcut: equal-count scrollback turnover can miss a repeat; use line markers if needed.
    for (const [url, count] of urls) {
      if (count > (previous?.get(url) ?? 0)) added.add(url);
    }
    seen.set(buffer.type, urls);
    if (!added.size) return;
    let command: string | null = null;
    try {
      const standing = await invoke<Glance[]>("pty_standing");
      command = pageCommand(standing.find((one) => one.id === session.id));
    } catch {
      return;
    }
    if (!live || !command) return;
    pages = rememberPages(
      currentPages(),
      [...added].map((url) => ({ sessionId: session.id, url, command })),
    );
    keepFrontValue("canvas.pages", pages);
    changes.notify();
  };
  const schedule = () => {
    timer ??= setTimeout(() => void collect(), 250);
  };
  const parsed = terminal.onWriteParsed(schedule);
  const hyperlinks = terminal.parser.registerOscHandler(8, (data) => {
    try {
      linked.add(webAddress(data.slice(data.indexOf(";") + 1), location.origin).href);
      schedule();
    } catch {}
    return false;
  });
  return {
    dispose() {
      live = false;
      clearTimeout(timer);
      parsed.dispose();
      hyperlinks.dispose();
    },
  };
}

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
  let seen = new Set<string>();
  const linked = new Set<string>();
  const collect = async (readCommand = true) => {
    timer = undefined;
    const urls = new Set([...pageUrls(terminal.buffer.active, location.origin), ...linked]);
    linked.clear();
    const added = [...urls].filter((url) => !seen.has(url));
    seen = urls;
    if (!added.length) return;
    let command: string | null = null;
    if (readCommand) {
      try {
        const standing = await invoke<Glance[]>("pty_standing");
        command = pageCommand(standing.find((one) => one.id === session.id));
      } catch {
        // A missed status read must not lose an otherwise usable URL.
      }
    }
    if (!live) return;
    pages = rememberPages(
      currentPages(),
      added.map((url) => ({ cwd: session.cwd, url, command })),
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
  // Retained output may predate the current command; preserve its saved labels.
  void collect(false);
  return {
    dispose() {
      live = false;
      clearTimeout(timer);
      parsed.dispose();
      hyperlinks.dispose();
    },
  };
}

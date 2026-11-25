import type { IBuffer } from "@xterm/xterm";
import type { Glance } from "../monitor/model.ts";
import { isAgent } from "../monitor/model.ts";
import { webAddress } from "./model.ts";

export type CanvasPage = { sessionId: string; url: string; command: string };

export function pageCommand(glance: Glance | undefined): string | null {
  // Agent prompts and the agent process itself do not identify the command that emitted a URL.
  if (!glance || isAgent(glance)) return null;
  return glance.said?.trim() || glance.running?.trim() || null;
}

export function pageUrls(buffer: IBuffer, appOrigin: string): Map<string, number> {
  let text = "";
  let cursor = -1;
  for (let row = 0; row < buffer.length; row++) {
    const line = buffer.getLine(row);
    if (!line) continue;
    text += line.isWrapped ? "" : "\n";
    if (row === buffer.baseY + buffer.cursorY)
      cursor = text.length + line.translateToString(false, 0, buffer.cursorX).length;
    text += line.translateToString(true);
  }
  const urls = new Map<string, number>();
  for (const match of text.matchAll(/https?:\/\/[^\s<>"'`{}|\\]+/gi)) {
    // A URL ending at the cursor may still be arriving in another output chunk.
    if (match.index + match[0].length === cursor) continue;
    try {
      let raw = match[0].replace(/[.,;!?]+$/, "");
      for (const [left, right] of [
        ["(", ")"],
        ["[", "]"],
      ]) {
        while (raw.endsWith(right) && raw.split(right).length > raw.split(left).length)
          raw = raw.slice(0, -1);
      }
      const url = webAddress(raw, appOrigin).href;
      urls.set(url, (urls.get(url) ?? 0) + 1);
    } catch {
      // Terminal output is untrusted; use the same URL boundary as opening a canvas page.
    }
  }
  return urls;
}

export function rememberPages(current: readonly CanvasPage[], added: readonly CanvasPage[]) {
  const next = [...current];
  for (const page of added) {
    const at = next.findIndex((one) => one.sessionId === page.sessionId && one.url === page.url);
    if (at >= 0) next.splice(at, 1);
    next.unshift(page);
  }
  // shortcut: keep the latest 200 links; add a searchable archive if longer history is needed.
  return next.slice(0, 200);
}

export function readPages(value: unknown, appOrigin: string): CanvasPage[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((page) => {
      if (
        !page ||
        typeof page.sessionId !== "string" ||
        !page.sessionId.trim() ||
        typeof page.url !== "string" ||
        typeof page.command !== "string" ||
        !page.command.trim()
      )
        return [];
      try {
        return [
          {
            sessionId: page.sessionId,
            url: webAddress(page.url, appOrigin).href,
            command: page.command,
          },
        ];
      } catch {
        return [];
      }
    })
    .slice(0, 200);
}

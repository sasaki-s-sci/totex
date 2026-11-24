import type { IBuffer } from "@xterm/xterm";
import type { Glance } from "../monitor/model.ts";
import { isAgent } from "../monitor/model.ts";
import { webAddress } from "./model.ts";

export type CanvasPage = { cwd: string; url: string; command: string | null };

export function pageCommand(glance: Glance | undefined): string | null {
  // Agent prompts and the agent process itself do not identify the command that emitted a URL.
  if (!glance || isAgent(glance)) return null;
  return glance.said || glance.running || null;
}

export function pageUrls(buffer: IBuffer, appOrigin: string): string[] {
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
  const urls = new Set<string>();
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
      urls.add(webAddress(raw, appOrigin).href);
    } catch {
      // Terminal output is untrusted; use the same URL boundary as opening a canvas page.
    }
  }
  return [...urls];
}

export function rememberPages(current: readonly CanvasPage[], added: readonly CanvasPage[]) {
  const next = [...current];
  for (const page of added) {
    const at = next.findIndex((one) => one.cwd === page.cwd && one.url === page.url);
    const previous = at >= 0 ? next.splice(at, 1)[0] : undefined;
    next.unshift({ ...page, command: page.command ?? previous?.command ?? null });
  }
  // shortcut: keep the latest 200 links; add a searchable archive if longer history is needed.
  return next.slice(0, 200);
}

export function readPages(value: unknown, appOrigin: string): CanvasPage[] {
  if (!Array.isArray(value)) return [];
  return value
    .flatMap((page) => {
      if (!page || typeof page.cwd !== "string" || typeof page.url !== "string") return [];
      try {
        return [
          {
            cwd: page.cwd,
            url: webAddress(page.url, appOrigin).href,
            command: typeof page.command === "string" ? page.command : null,
          },
        ];
      } catch {
        return [];
      }
    })
    .slice(0, 200);
}

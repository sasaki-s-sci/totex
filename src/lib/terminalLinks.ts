import { openPage } from "./openPage.ts";

/** Both detected URLs and OSC 8 hyperlinks, on Ctrl+click only. */
export function openTerminalLink(event: MouseEvent, uri: string, sessionId?: string): void {
  if (!event.ctrlKey || event.button !== 0) return;
  // Activation runs on mouseup; stopping it would keep xterm's document-level
  // selection drag alive, so the next mouse move extends a selection.
  event.preventDefault();

  openPage(uri, sessionId);
}

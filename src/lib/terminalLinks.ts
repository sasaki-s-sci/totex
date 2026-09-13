import { openUrl } from "@tauri-apps/plugin-opener";

/** Both detected URLs and OSC 8 hyperlinks, on Ctrl+click only. */
export function openTerminalLink(event: MouseEvent, uri: string): void {
  if (!event.ctrlKey || event.button !== 0) return;
  event.preventDefault();
  event.stopPropagation();

  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return;
  void openUrl(url.href).catch((error) => console.error("Could not open terminal URL", error));
}

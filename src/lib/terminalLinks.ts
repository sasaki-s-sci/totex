import { openUrl } from "@tauri-apps/plugin-opener";

/** Open both detected URLs and OSC 8 hyperlinks with Ctrl+click. */
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

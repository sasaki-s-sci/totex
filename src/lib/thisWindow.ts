import { getCurrentWindow } from "@tauri-apps/api/window";
import { isCardLabel } from "./cardWindow";

/**
 * From the native window, not the URL: the front is drawn in a frame whose address says nothing
 * about the window.
 */
export function windowLabel(): string {
  try {
    return getCurrentWindow().label;
  } catch {
    // Outside any app window, as in a browser preview, counts as the main one.
    return "main";
  }
}

export function isCardWindow(): boolean {
  return isCardLabel(windowLabel());
}

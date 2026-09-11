/**
 * Which window this page is being drawn in.
 *
 * The app's own window, or one holding a single card torn off it — see
 * `cardWindow`. The label is the one thing that says which, and it is read
 * off the native window rather than off the URL: the shell draws the front
 * inside a frame of its own, and a frame's address says nothing about the
 * window around it.
 */

import { getCurrentWindow } from "@tauri-apps/api/window";
import { isCardLabel } from "./cardWindow";

export function windowLabel(): string {
  try {
    return getCurrentWindow().label;
  } catch {
    // Drawn somewhere that is not a window of this app at all — a browser
    // during a preview — which is the app's own window as far as the page
    // is concerned.
    return "main";
  }
}

/** This page is drawing one card and nothing else. */
export function isCardWindow(): boolean {
  return isCardLabel(windowLabel());
}

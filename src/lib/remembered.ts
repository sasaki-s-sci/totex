/**
 * What the window keeps between windows, kept by the program beside it.
 *
 * The webview's own storage survives a restart, and that is nearly enough.
 * What it does not survive is the webview's profile being cleared, and what it
 * cannot do is be written by one program: two windows in the middle of a swap
 * are two writers of one store. So everything worth keeping is handed to the
 * keep -- see `src-tauri/src/keep.rs` -- under a name, as JSON it does not
 * read, and read back from there.
 *
 * The webview's storage stays as the copy that is there before anything has
 * been asked: the column starts where it was without waiting on a socket, and
 * `prime` brings that copy up to date with the keep's before the pages draw.
 * A window that has never handed anything to the keep hands over what the
 * webview had, which is how a copy from before this existed comes across.
 */

import { invoke } from "@tauri-apps/api/core";

/** The names under which the pages keep things, as the webview storage had them. */
const REMEMBERED = ["totex.roots", "totex.places"] as const;

/**
 * Keeps one document under its name: in the webview's storage for the next
 * read, and with the keep for the next window.
 */
export function remember(name: string, value: unknown): void {
  try {
    localStorage.setItem(name, JSON.stringify(value));
  } catch {
    // Kept with the keep and no longer here, which is the copy that matters.
  }
  invoke("keep_put", { name, value }).catch(() => undefined);
}

/**
 * Brings the webview's copy of every remembered document up to date with the
 * keep's, or hands the keep what the webview had where the keep has nothing.
 *
 * Called once, before the pages draw, so that what `storedRoots` and
 * `keptPlaces` read is what the last window left with the keep rather than
 * what this webview last saw -- which are only different when the webview's
 * storage was cleared, or when the window last closed was on another copy of
 * the pages.
 */
export async function prime(): Promise<void> {
  await Promise.all(
    REMEMBERED.map(async (name) => {
      let kept: unknown;
      try {
        kept = await invoke<unknown>("keep_get", { name });
      } catch {
        // No keep to ask -- a page opened outside the app -- and nothing to
        // bring across.
        return;
      }
      try {
        if (kept === null || kept === undefined) {
          const here = localStorage.getItem(name);
          if (here !== null) {
            invoke("keep_put", { name, value: JSON.parse(here) }).catch(() => undefined);
          }
          return;
        }
        localStorage.setItem(name, JSON.stringify(kept));
      } catch {
        // A webview that will not hold it starts as it always has, and the
        // keep goes on holding the copy that matters.
      }
    }),
  );
}

/**
 * Moving a native window after the pointer, one request at a time.
 *
 * A pointer reports many times a frame and a window is moved over IPC: a
 * request per report would queue up behind the first and the window would
 * arrive where the pointer was a while ago. So one request is in flight at a
 * time, and only the newest place is kept to send after it — the places in
 * between are places the pointer has already left.
 */

import { LogicalPosition } from "@tauri-apps/api/dpi";
import type { Window } from "@tauri-apps/api/window";
import type { Point } from "./cardWindow";

export function mover(window: Window | Promise<Window>): (at: Point) => void {
  let busy = false;
  let next: Point | null = null;
  const send = (at: Point) => {
    busy = true;
    void Promise.resolve(window)
      .then((it) => it.setPosition(new LogicalPosition(at.x, at.y)))
      .catch(() => undefined)
      .finally(() => {
        busy = false;
        const again = next;
        next = null;
        if (again) send(again);
      });
  };
  return (at) => {
    if (busy) next = at;
    else send(at);
  };
}

import { LogicalPosition } from "@tauri-apps/api/dpi";
import type { Window } from "@tauri-apps/api/window";
import type { Point } from "./cardWindow";

/** One IPC move in flight at a time; only the newest position is queued behind it. */
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

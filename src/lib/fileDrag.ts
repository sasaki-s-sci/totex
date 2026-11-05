import type { PointerEvent } from "react";
import { baseName } from "../folder/format";
import { writeFileDrag } from "./filePreview";
import type { SelectionEntry } from "./fileSelection";
import { startPointerDrag } from "./pointerDrag";

export function startFileDrag(
  event: PointerEvent<HTMLElement>,
  pick: () => readonly SelectionEntry[],
): void {
  const source = event.currentTarget;
  startPointerDrag(
    event.nativeEvent,
    source,
    (data) => {
      const entries = pick();
      writeFileDrag(data, entries);
      return entries.map((entry) => baseName(entry.path)).join(", ");
    },
    source.closest("[data-folder-pane]")?.parentElement,
  );
}

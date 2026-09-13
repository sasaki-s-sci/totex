import type { XYPosition } from "@xyflow/react";
import { useCallback, useState } from "react";

export function useFolderPlaces() {
  const [places, setPlaces] = useState<ReadonlyMap<string, XYPosition>>(() => new Map());

  // An offset from the folder's laid-out slot, not a position: layout changes still push the group, and a folder put back is forgotten.
  const placeFolder = useCallback((root: string, at: XYPosition) => {
    setPlaces((current) => {
      const held = current.get(root);
      if (at.x === 0 && at.y === 0) {
        if (!held) return current;
        const next = new Map(current);
        next.delete(root);
        return next;
      }

      if (held && held.x === at.x && held.y === at.y) return current;
      const next = new Map(current);
      next.set(root, at);
      return next;
    });
  }, []);

  return { places, placeFolder };
}

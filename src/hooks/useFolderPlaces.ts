import type { XYPosition } from "@xyflow/react";
import { useCallback, useState } from "react";

/**
 * How far each folder has been carried from where the canvas laid it out.
 *
 * The arrangement is the canvas's: folders go down the page in the order they
 * were opened, and each one's repositories go down under it. That is the right
 * answer nearly always, and it is nobody's answer for the one thing a canvas is
 * for — putting two things somebody is working on next to each other. So a
 * folder can be taken by its own mark and carried anywhere, and this is what is
 * remembered of that.
 *
 * A move rather than a place, and that is the whole of why it works: the slot a
 * group was given is still its own, so a repository opening out above it still
 * pushes it down, a folder closed above it still lets it up, and the only thing
 * that ever moved by hand is the thing that was in the hand. A folder put back
 * where it belongs is forgotten entirely — there is nothing left to remember.
 */
export function useFolderPlaces() {
  const [places, setPlaces] = useState<ReadonlyMap<string, XYPosition>>(() => new Map());

  const placeFolder = useCallback((root: string, at: XYPosition) => {
    setPlaces((current) => {
      const held = current.get(root);
      if (at.x === 0 && at.y === 0) {
        if (!held) return current;
        const next = new Map(current);
        next.delete(root);
        return next;
      }
      // The same answer is not a change, and the graph is rebuilt from this.
      if (held && held.x === at.x && held.y === at.y) return current;
      const next = new Map(current);
      next.set(root, at);
      return next;
    });
  }, []);

  return { places, placeFolder };
}

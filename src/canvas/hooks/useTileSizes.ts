import { useCallback, useState } from "react";
import { clampTile } from "../../lib/graph";

/** Each plain terminal's tile height in grid steps, by session; a session not here stands at the start size. */
export function useTileSizes() {
  const [tiles, setTiles] = useState<ReadonlyMap<string, number>>(() => new Map());

  const resizeTile = useCallback((session: string, units: number) => {
    setTiles((current) => new Map(current).set(session, clampTile(units)));
  }, []);

  return { tiles, resizeTile };
}

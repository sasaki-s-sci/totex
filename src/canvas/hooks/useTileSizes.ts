import { useCallback, useState } from "react";
import { clampTile } from "../../lib/graph";

/** Tile resize units by session; a session not here stands at the two-line default. */
export function useTileSizes() {
  const [tiles, setTiles] = useState<ReadonlyMap<string, number>>(() => new Map());

  const resizeTile = useCallback((session: string, units: number) => {
    setTiles((current) => new Map(current).set(session, clampTile(units)));
  }, []);

  return { tiles, resizeTile };
}

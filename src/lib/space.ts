import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

export type SpaceSettings = {
  /** Default on: the settings switch already says whether a door exists at all. */
  mcp: boolean;
};

export type SpaceStanding = {
  space: string;
  told: boolean;
  settings: SpaceSettings;
};

export function spaceStanding(path: string): Promise<SpaceStanding> {
  return invoke<SpaceStanding>("space_standing", { path });
}

export function tellSpace(path: string, settings: SpaceSettings): Promise<SpaceStanding> {
  return invoke<SpaceStanding>("space_tell", { path, settings });
}

export function useSpace(path: string) {
  const [standing, setStanding] = useState<SpaceStanding | null>(null);

  useEffect(() => {
    let alive = true;
    spaceStanding(path)
      .then((answer) => alive && setStanding(answer))
      .catch(() => alive && setStanding(null));
    return () => {
      alive = false;
    };
  }, [path]);

  // Written optimistically; the answer, or a refusal, puts the mark where it landed.
  const tell = useCallback(
    (settings: SpaceSettings) => {
      setStanding((was) => (was ? { ...was, settings } : was));
      tellSpace(path, settings)
        .then(setStanding)
        .catch(() =>
          spaceStanding(path)
            .then(setStanding)
            .catch(() => undefined),
        );
    },
    [path],
  );

  return { standing, tell };
}

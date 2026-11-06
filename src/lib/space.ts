import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

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
  const [reading, setReading] = useState<{ path: string; standing: SpaceStanding | null }>({
    path,
    standing: null,
  });
  const request = useRef(0);

  useEffect(() => {
    const current = ++request.current;
    setReading({ path, standing: null });
    spaceStanding(path)
      .then((standing) => current === request.current && setReading({ path, standing }))
      .catch(() => current === request.current && setReading({ path, standing: null }));
    return () => {
      request.current++;
    };
  }, [path]);

  // Written optimistically; the answer, or a refusal, puts the mark where it landed.
  const tell = useCallback(
    (settings: SpaceSettings) => {
      const current = ++request.current;
      const accept = (standing: SpaceStanding) => {
        if (current === request.current) setReading({ path, standing });
      };
      setReading((was) =>
        was.path === path && was.standing ? { path, standing: { ...was.standing, settings } } : was,
      );
      tellSpace(path, settings)
        .then(accept)
        .catch(() =>
          current === request.current
            ? spaceStanding(path)
                .then(accept)
                .catch(() => undefined)
            : undefined,
        );
    },
    [path],
  );

  return { standing: reading.path === path ? reading.standing : null, tell };
}

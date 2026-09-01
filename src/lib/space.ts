/**
 * The folder a command line stands in, and what somebody keeps there.
 *
 * A space is where a terminal is opened, and `.totex` inside it is where a fact
 * about that place is written down — found the way `.git` is found, by walking
 * up from wherever the shell is. See `src-tauri/src/space`, which is where all
 * of the finding happens; nothing on this side works a path out for itself.
 *
 * It is rarely the folder a pane is showing. A pane opened halfway down a
 * checkout is standing in the space at the checkout's root, and two panes
 * opened at two folders of one project are standing in the same one — so what
 * comes back names the space as well as answering for it, and the window says
 * which folder it is about rather than letting somebody set one and change
 * another.
 */

import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";

/** What a space says about the terminals opened in it. */
export type SpaceSettings = {
  /** Whether a session started here is handed this window's own door — which
   *  is what lets the agent in it say what it is working on. On until it is
   *  turned off: the switch on the settings page is already the one that says
   *  whether there is a door at all. */
  mcp: boolean;
};

/** What a folder's space says, and where the space saying it is. */
export type SpaceStanding = {
  /** The folder holding `.totex`, or the one that would come to hold it. */
  space: string;
  /** Whether it is there yet. */
  told: boolean;
  settings: SpaceSettings;
};

export function spaceStanding(path: string): Promise<SpaceStanding> {
  return invoke<SpaceStanding>("space_standing", { path });
}

export function tellSpace(path: string, settings: SpaceSettings): Promise<SpaceStanding> {
  return invoke<SpaceStanding>("space_tell", { path, settings });
}

/**
 * What the space around one folder says, and the one way to change it.
 *
 * Null until the answer arrives, and null again where it could not be asked:
 * both of those are a folder there is nothing to say about yet, and a mark
 * drawn from a guess would be a mark saying the wrong thing for as long as it
 * took to find out.
 *
 * The answer is taken from the write rather than asked for again. A press is
 * the one thing that changes this, and the side that wrote it is the side that
 * knows where it landed — a space made just now is at a folder this side had
 * no way to name before it existed.
 */
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

  const tell = useCallback(
    (settings: SpaceSettings) => {
      // Drawn as asked for straight away, and put back by the answer. What is
      // being written is one line in one small file; waiting on the disk before
      // the mark moves would be a mark that lags a press for no reason anybody
      // pressing it could see.
      setStanding((was) => (was ? { ...was, settings } : was));
      tellSpace(path, settings)
        .then(setStanding)
        // A space that would not take it is a space that still says whatever it
        // said before, so the mark goes back to that rather than staying where
        // the press left it.
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

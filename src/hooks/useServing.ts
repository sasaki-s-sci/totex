import { useCallback, useEffect, useState } from "react";

import { install, serve, servingNow, stopServing } from "../lib/mcp";

/** Where the choice is kept, so that it outlives the window. */
const KEY = "totex.mcp.serving";

export type ServingControls = {
  serving: boolean;
  activity: "checking" | "idle" | "changing" | "failed";
  change: (next: boolean) => void;
  installing: "rest" | "working" | "done" | "failed";
  register: () => void;
};

/**
 * Whether the server is standing, and the two things that can be done about it.
 *
 * The choice outlives the window and the server does not. A server is a port
 * held open by this process: it goes when the app goes, and a window that comes
 * back up stands it again because that is what was asked for the last time
 * anybody said. So what is remembered is the answer to "should there be one",
 * and the port itself is asked for afresh.
 *
 * It is off until it is turned on, and stays off until it is. Opening a port
 * because the app happened to start is a program doing something on somebody's
 * machine that they did not ask for — and until an agent has been registered
 * against it there is nothing at the other end to say anything anyway.
 */
export function useServing(): ServingControls {
  const [serving, setServing] = useState(false);
  const [activity, setActivity] = useState<ServingControls["activity"]>("checking");
  /** What the last press did, for the mark to draw. */
  const [installing, setInstalling] = useState<ServingControls["installing"]>("rest");

  useEffect(() => {
    let alive = true;

    // What is actually up, not what was wanted: a window that was reloaded is
    // in front of a server this process already stood, and the two answers only
    // differ while one of them is a lie.
    const restore = async () => {
      try {
        const port = await servingNow();
        if (!alive) return;
        if (port !== null) {
          setServing(true);
        } else if (wanted()) {
          await serve();
          if (alive) setServing(true);
        }
      } catch {
        if (alive) setActivity("failed");
        return;
      }
      if (alive) setActivity("idle");
    };

    void restore();

    return () => {
      alive = false;
    };
  }, []);

  /** Stands it up, or takes it down, and remembers which was asked for. */
  const change = useCallback((next: boolean) => {
    remember(next);
    setServing(next);
    setActivity("changing");

    const settle = async () => {
      try {
        await (next ? serve() : stopServing());
        setActivity("idle");
      } catch {
        // An invoke can fail after the command reached the program. Ask the
        // server itself before drawing a state that may be the opposite of the
        // one it is actually in.
        try {
          setServing((await servingNow()) !== null);
        } catch {
          setServing(!next);
        }
        setActivity("failed");
      }
    };

    void settle();
  }, []);

  /**
   * Writes the one line of setup into the coding agent on this machine.
   *
   * Separate from turning the server on, because they are separate things: one
   * is this app opening a door and the other is somebody else's program being
   * told where it is. The second is done once and never again — the address it
   * is written against is the same for every session there will ever be.
   */
  const register = useCallback(() => {
    setInstalling("working");
    install()
      .then(() => setInstalling("done"))
      .catch(() => setInstalling("failed"));
  }, []);

  return { serving, activity, change, installing, register };
}

function wanted(): boolean {
  try {
    return localStorage.getItem(KEY) === "yes";
  } catch {
    // A window that cannot remember opens without a server, which is where
    // every window starts.
    return false;
  }
}

function remember(serving: boolean) {
  try {
    localStorage.setItem(KEY, serving ? "yes" : "no");
  } catch {
    // The server is standing either way; it is only the next window that will
    // not know it was asked for.
  }
}

import { useCallback, useEffect, useState } from "react";

import { install, serve, servingNow, stopServing } from "../lib/mcp";

/** Where the choice is kept, so that it outlives the window. */
const KEY = "totex.mcp.serving";

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
export function useServing() {
  const [serving, setServing] = useState(false);
  /** What the last press did, for the mark to draw. */
  const [installing, setInstalling] = useState<"rest" | "working" | "done" | "failed">("rest");

  useEffect(() => {
    let alive = true;

    // What is actually up, not what was wanted: a window that was reloaded is
    // in front of a server this process already stood, and the two answers only
    // differ while one of them is a lie.
    servingNow()
      .then((port) => {
        if (!alive) return;
        if (port !== null) {
          setServing(true);
          return;
        }
        if (!wanted()) return;
        return serve().then(() => {
          if (alive) setServing(true);
        });
      })
      .catch(() => undefined);

    return () => {
      alive = false;
    };
  }, []);

  /** Stands it up, or takes it down, and remembers which was asked for. */
  const toggle = useCallback(() => {
    setServing((current) => {
      const next = !current;
      remember(next);
      void (next ? serve() : stopServing()).catch(() => undefined);
      return next;
    });
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

  return { serving, toggle, installing, register };
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

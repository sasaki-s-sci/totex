import { useCallback, useEffect, useState } from "react";

import {
  type Agent,
  setups as askSetups,
  install,
  type Setup,
  serve,
  servingNow,
  stopServing,
} from "../lib/mcp";

/** Where the choice is kept, so that it outlives the window. */
const KEY = "totex.mcp.serving";

/** What the last press against one agent did, for the button to draw. */
export type Installing = "rest" | "working" | "done" | "failed";

export type ServingControls = {
  serving: boolean;
  activity: "checking" | "idle" | "changing" | "failed";
  change: (next: boolean) => void;
  /** What each agent would be set up with, in the words it would be typed in. */
  setups: Setup[];
  /** What the last press did, for each agent that has been pressed at all. */
  installing: Partial<Record<Agent, Installing>>;
  register: (agent: Agent) => void;
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
  const [setups, setSetups] = useState<Setup[]>([]);
  /** What the last press did, for the mark on each button to draw. */
  const [installing, setInstalling] = useState<ServingControls["installing"]>({});

  /**
   * What the agents would be set up with, asked again whenever the door moves.
   *
   * One of the lines carries the port in it, and the port is the one standing:
   * a line read off this page while the server was down and pressed after it
   * came up would be a line about a door somewhere else.
   */
  const read = useCallback(() => {
    askSetups()
      .then(setSetups)
      // A page with no lines on it says nothing, which is the right amount to
      // say about a machine that could not be asked.
      .catch(() => setSetups([]));
  }, []);

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
      if (alive) {
        setActivity("idle");
        read();
      }
    };

    void restore();

    return () => {
      alive = false;
    };
  }, [read]);

  /** Stands it up, or takes it down, and remembers which was asked for. */
  const change = useCallback(
    (next: boolean) => {
      remember(next);
      setServing(next);
      setActivity("changing");

      const settle = async () => {
        try {
          await (next ? serve() : stopServing());
          setActivity("idle");
        } catch {
          // An invoke can fail after the command reached the program. Ask the
          // server itself before drawing a state that may be the opposite of
          // the one it is actually in.
          try {
            setServing((await servingNow()) !== null);
          } catch {
            setServing(!next);
          }
          setActivity("failed");
        }
        read();
      };

      void settle();
    },
    [read],
  );

  /**
   * Writes the setup into one coding agent on this machine.
   *
   * Separate from turning the server on, because they are separate things: one
   * is this app opening a door and the other is somebody else's program being
   * told where it is. The second is done once and rarely again — what is
   * written is the same for every session there will ever be.
   *
   * One agent at a time, and one answer per agent: two of them are set up by
   * two different programs, and a press that failed says nothing about the one
   * beside it.
   */
  const register = useCallback((agent: Agent) => {
    setInstalling((was) => ({ ...was, [agent]: "working" }));
    install(agent)
      .then(() => setInstalling((was) => ({ ...was, [agent]: "done" })))
      .catch(() => setInstalling((was) => ({ ...was, [agent]: "failed" })));
  }, []);

  return { serving, activity, change, setups, installing, register };
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

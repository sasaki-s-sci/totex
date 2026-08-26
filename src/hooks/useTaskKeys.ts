/**
 * The key that asks a repository what it can run.
 *
 * Ctrl and Alt and A: the workspace the panel is showing is asked what its
 * runners say can be run in it, and the list opens over the window. It is the
 * key beside the one that opens another terminal there — Ctrl and A — because
 * what it comes to is the same thing: a terminal in that directory, with the
 * line already typed into it.
 *
 * Nothing opens when the panel is holding nothing, for the reason Ctrl and A
 * opens nothing then: there is no workspace in view, and a list of what can be
 * run somewhere the eye has already left is a list of the wrong commands.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import type { Session } from "../lib/session";

type Options = {
  /** Everything that is running, which is where the shown one is looked up. */
  sessions: readonly Session[];
  /** The one the panel is holding, whose directory is asked. */
  showing: string | null;
};

export function useTaskKeys({ sessions, showing }: Options) {
  /** The workspace the list is open for, or null while it is not open. */
  const [asking, setAsking] = useState<Session | null>(null);
  const close = useCallback(() => setAsking(null), []);

  // The listener is registered once and reads through this: a session opening
  // or ending is not a reason to take it off the window and put it back.
  const latest = useRef({ sessions, showing });
  latest.current = { sessions, showing };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Ctrl and Alt together, which is one key here and AltGr on a keyboard
      // that has one — so it is the letter that is read rather than the place
      // on the board, and a layout where AltGr and A make a letter of their own
      // makes that letter instead of this.
      if (!event.ctrlKey || !event.altKey || event.metaKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== "a") return;
      event.preventDefault();
      // A held key is one press: left to repeat, this would ask the same
      // directory a frame for as long as the finger was down.
      if (event.repeat) return;

      setAsking((open) => {
        // Open already: the same press puts it away, so the key is one gesture
        // rather than one that only ever goes one way.
        if (open) return null;
        const { sessions, showing } = latest.current;
        return sessions.find((session) => session.id === showing) ?? null;
      });
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return { asking, close };
}

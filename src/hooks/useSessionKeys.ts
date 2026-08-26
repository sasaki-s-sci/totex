/**
 * The key that opens another terminal where one is already open.
 *
 * Ctrl and A: the workspace the panel is showing is given a second terminal
 * beside the first — same directory, same branch — and the panel comes to rest
 * on the new one. It is the button on that branch's ring pressed again, without
 * having to find the branch on the canvas first, and what it is for is leaving
 * the terminal being typed in to carry on running while the next thing is done
 * beside it.
 *
 * Nothing is opened when the panel is holding nothing. There is no workspace
 * open then, and starting one in whatever was last shown would be a press that
 * sometimes ran a shell somewhere the eye had already left.
 */

import { useEffect, useRef } from "react";

import { terminal, typing } from "../lib/keys";
import { type Session, shellSession } from "../lib/session";

type Options = {
  /** Everything that is running, which is where the shown one is looked up. */
  sessions: readonly Session[];
  /** The one the panel is holding, whose directory the next one is opened in. */
  showing: string | null;
  /** Starts one and shows it — the window's own `open`, and nothing else. */
  open: (session: Session) => void;
};

export function useSessionKeys({ sessions, showing, open }: Options) {
  // The listener is registered once and reads through this: a session opening
  // or ending is not a reason to take it off the window and put it back.
  const latest = useRef({ sessions, showing, open });
  latest.current = { sessions, showing, open };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Ctrl, and nothing beside it, as with every other key the window takes.
      if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      if (event.key !== "a" && event.key !== "A") return;
      // Select-all belongs to whatever is being written in. A terminal is the
      // exception: this is a shell key that is taken from it deliberately —
      // see `CliView`, which is the other half of that — and it is the one
      // place where the workspace this opens in is certainly the one in view.
      if (typing(event.target) && !terminal(event.target)) return;

      const { sessions, showing, open } = latest.current;
      const shown = sessions.find((session) => session.id === showing);
      if (!shown) return;

      event.preventDefault();
      // A held key is one press: left to repeat, this would start a shell a
      // frame for as long as the finger was down.
      if (event.repeat) return;
      open(shellSession(shown.cwd, shown.branch));
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

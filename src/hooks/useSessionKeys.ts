// Ctrl+A: a second terminal in the shown session's workspace.

import { useEffect, useRef } from "react";

import { settingsNow } from "../lib/appSettings";
import { terminal, typing } from "../lib/keys";
import { type Session, shellSession } from "../lib/session";

type Options = {
  sessions: readonly Session[];
  showing: string | null;
  open: (session: Session, below?: string) => void;
};

export function useSessionKeys({ sessions, showing, open }: Options) {
  const latest = useRef({ sessions, showing, open });
  latest.current = { sessions, showing, open };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
      if (event.key !== "a" && event.key !== "A") return;
      // Select-all belongs to what is being written in, except a terminal, which gives the key up
      // in `CliView`.
      if (typing(event.target) && !terminal(event.target)) return;

      const { sessions, showing, open } = latest.current;
      const shown = sessions.find((session) => session.id === showing);
      if (!shown) return;

      event.preventDefault();
      // Not on repeat.
      if (event.repeat) return;
      const below = settingsNow().terminalSort === "createdWhere" ? shown.id : undefined;
      open(shellSession(shown.cwd, shown.branch, shown.folder), below);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);
}

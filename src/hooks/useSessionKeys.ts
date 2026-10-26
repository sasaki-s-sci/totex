// Ctrl+A: a second terminal in the shown session's workspace.

import { useEffect, useRef } from "react";

import { settingsNow } from "../lib/appSettings";
import { terminal, typing } from "../lib/keys";
import { type Session, shellSession } from "../lib/session";

type Options = {
  sessions: readonly Session[];
  showing: string | null;
  open: (session: Session, below?: string) => void;
  jump: (session: Session) => void;
};

const STEPS: Record<string, number> = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 };

export function useSessionKeys({ sessions, showing, open, jump }: Options) {
  const latest = useRef({ sessions, showing, open, jump });
  latest.current = { sessions, showing, open, jump };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Ctrl+Alt+Arrow switches the shown shell to the one before or after it, wrapping round.
      if (event.ctrlKey && event.altKey && !event.metaKey && !event.shiftKey) {
        const step = STEPS[event.key];
        if (!step || (typing(event.target) && !terminal(event.target))) return;
        event.preventDefault();
        if (event.repeat) return;
        const { sessions, showing, jump } = latest.current;
        const at = sessions.findIndex((session) => session.id === showing);
        if (at < 0) return;
        jump(sessions[(at + step + sessions.length) % sessions.length]);
        return;
      }

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

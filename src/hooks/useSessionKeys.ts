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
  end: (session: Session) => void;
};

const STEPS: Record<string, number> = { ArrowUp: -1, ArrowLeft: -1, ArrowDown: 1, ArrowRight: 1 };

export function useSessionKeys({ sessions, showing, open, jump, end }: Options) {
  const latest = useRef({ sessions, showing, open, jump, end });
  latest.current = { sessions, showing, open, jump, end };

  useEffect(() => {
    let typed: { number: number; at: number } | null = null;
    const onKeyDown = (event: KeyboardEvent) => {
      // Navigation belongs to the sessions, independently of where their pages are shown.
      if (event.ctrlKey && !event.metaKey && !event.shiftKey) {
        if (typing(event.target) && !terminal(event.target)) return;
        const { sessions, showing, jump } = latest.current;
        if (!event.altKey && /^[0-9]$/.test(event.key)) {
          event.preventDefault();
          if (event.repeat) return;
          const digit = Number(event.key);
          const combined = typed && Date.now() - typed.at < 700 ? typed.number * 10 + digit : digit;
          const number = combined > sessions.length ? digit : combined;
          const next = sessions[number - 1];
          typed = next ? { number, at: Date.now() } : null;
          if (next) jump(next);
          return;
        }
        if (event.key.toLowerCase() === "x") {
          if (typing(event.target) && !terminal(event.target)) return;
          const { sessions, showing, end } = latest.current;
          const selected = sessions.find((session) => session.id === showing);
          if (!selected) return;
          event.preventDefault();
          if (!event.repeat) end(selected);
          return;
        }
        const step = STEPS[event.key];
        if (!step) {
          if (event.altKey) return;
        } else {
          event.preventDefault();
          if (event.repeat) return;
          typed = null;
          const at = sessions.findIndex((session) => session.id === showing);
          if (at < 0) return;
          let next = (at + step + sessions.length) % sessions.length;
          if (!event.altKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
            while (next !== at && sessions[next].cwd === sessions[at].cwd)
              next = (next + step + sessions.length) % sessions.length;
          }
          jump(sessions[next]);
          return;
        }
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

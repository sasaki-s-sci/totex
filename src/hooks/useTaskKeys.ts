import { useCallback, useEffect, useRef, useState } from "react";
import { startShell, writeShell } from "../lib/pty";
import { type Session, shellSession } from "../lib/session";

type Options = {
  sessions: readonly Session[];
  showing: string | null;
  open: (session: Session) => void;
};

/** Ctrl+Alt+A asks the shown session's workspace what its runners can run. */
export function useTaskKeys({ sessions, showing, open }: Options) {
  const [asking, setAsking] = useState<Session | null>(null);
  const close = useCallback(() => setAsking(null), []);

  const latest = useRef({ sessions, showing });
  latest.current = { sessions, showing };

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.altKey || event.metaKey || event.shiftKey) return;
      if (event.key.toLowerCase() !== "a") return;
      event.preventDefault();
      if (event.repeat) return;
      setAsking((held) => {
        if (held) return null;
        const { sessions, showing } = latest.current;
        return sessions.find((session) => session.id === showing) ?? null;
      });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // A fresh terminal rather than the shown one: whatever runs in there is somebody's.
  const run = useCallback(
    (session: Session, line: string) => {
      close();
      const next = shellSession(session.cwd, session.branch, session.folder);
      open(next);
      void startShell(next)
        .then(() => writeShell(next.id, `${line}\n`))
        .catch(() => undefined);
    },
    [close, open],
  );

  return { asking, close, run };
}

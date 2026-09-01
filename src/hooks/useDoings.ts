import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useState } from "react";

import { type Doing, doingNow, onDoing } from "../lib/doing";
import { EXIT_EVENT } from "../lib/pty";

/** Nothing is running anywhere, which is a window that has just come up. */
const NOTHING: ReadonlyMap<string, Doing> = new Map();

/**
 * What every running session is doing, kept current.
 *
 * Keyed by session, because that is what the graph draws the mark for. A
 * session that is not in here is one nothing has been heard about yet — which
 * is a shell in the moment between being started and printing its prompt — and
 * the mark it wears meanwhile is the plain one.
 *
 * Nothing is held back the way a question is. A question is read off a screen
 * drawn in frames, so a reading has to be given a moment to turn out to be
 * real; this is one of three states, it is only ever sent when it changed, and
 * a mark that is a moment late saying a build has finished is a mark nobody
 * misreads.
 */
export function useDoings(): ReadonlyMap<string, Doing> {
  const [doings, setDoings] = useState<ReadonlyMap<string, Doing>>(NOTHING);

  const put = useCallback((id: string, doing: Doing | null) => {
    setDoings((current) => {
      if ((current.get(id) ?? null) === doing) return current;
      const next = new Map(current);
      if (doing) next.set(id, doing);
      else if (!next.delete(id)) return current;
      return next;
    });
  }, []);

  useEffect(() => {
    let alive = true;

    const listening = onDoing(({ id, doing }) => {
      if (alive) put(id, doing);
    });
    // A session that has ended is not doing anything, and nothing will ever
    // come to say so: the screen it was being read from is gone with it.
    const finished = listen<string>(EXIT_EVENT, (event) => {
      if (alive) put(event.payload, null);
    });

    doingNow()
      .then((standing) => {
        if (!alive) return;
        for (const { id, doing } of standing) put(id, doing);
      })
      .catch(() => undefined);

    return () => {
      alive = false;
      void listening.then((off) => off()).catch(() => undefined);
      void finished.then((off) => off()).catch(() => undefined);
    };
  }, [put]);

  return doings;
}

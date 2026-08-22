import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

import { type Ask, answerAsk, askingNow, onAsking } from "../lib/ask";
import { EXIT_EVENT } from "../lib/pty";

/** Nothing is being asked, which is the ordinary state of the machine. */
const NOTHING: ReadonlyMap<string, Ask> = new Map();

/**
 * How long a question has to hold still before it is drawn.
 *
 * An agent draws its box in frames, and a frame that arrived half-written is a
 * question that was never being asked. The reading already turns most of those
 * down — a box with no foot on it yet is not a question — and this is for the
 * rest: a card that appeared and vanished inside a tenth of a second was
 * flicker whatever it said, and a tenth of a second is not long to wait for one
 * that is real.
 *
 * Not paid on the way out by anyone who answers from the graph: pressing an
 * answer takes its own card away at once.
 */
const SETTLE_MS = 120;

/**
 * What every running session is asking, kept current.
 *
 * Keyed by session, because that is what an answer is addressed to and what the
 * graph draws the card beside. A session that is not asking anything is not in
 * here at all — which is nearly all of them, nearly all of the time.
 */
export function useAsks() {
  const [asks, setAsks] = useState<ReadonlyMap<string, Ask>>(NOTHING);
  /** What each session's next reading is waiting on, so it can be called off. */
  const settling = useRef(new Map<string, number>());

  const put = useCallback((id: string, ask: Ask | null) => {
    setAsks((current) => {
      if ((current.get(id) ?? null) === ask) return current;
      const next = new Map(current);
      if (ask) next.set(id, ask);
      else if (!next.delete(id)) return current;
      return next;
    });
  }, []);

  /** Holds a reading for as long as it takes to be sure it is one. */
  const hold = useCallback(
    (id: string, ask: Ask | null) => {
      const held = settling.current.get(id);
      if (held !== undefined) window.clearTimeout(held);
      const timer = window.setTimeout(() => {
        settling.current.delete(id);
        put(id, ask);
      }, SETTLE_MS);
      settling.current.set(id, timer);
    },
    [put],
  );

  /** Takes a session's question off the graph now, whatever was on its way. */
  const settle = useCallback(
    (id: string, ask: Ask | null) => {
      const held = settling.current.get(id);
      if (held !== undefined) {
        window.clearTimeout(held);
        settling.current.delete(id);
      }
      put(id, ask);
    },
    [put],
  );

  useEffect(() => {
    let alive = true;
    const timers = settling.current;

    const listening = onAsking(({ id, ask }) => {
      if (alive) hold(id, ask);
    });
    // A session that has ended is not asking anything, and nothing will ever
    // come to say so: the process it was being read from is gone.
    const finished = listen<string>(EXIT_EVENT, (event) => {
      if (alive) settle(event.payload, null);
    });

    askingNow()
      .then((standing) => {
        if (!alive) return;
        for (const { id, ask } of standing) settle(id, ask);
      })
      .catch(() => undefined);

    return () => {
      alive = false;
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
      void listening.then((off) => off()).catch(() => undefined);
      void finished.then((off) => off()).catch(() => undefined);
    };
  }, [hold, settle]);

  /**
   * Takes one of the answers, and takes the card with it.
   *
   * The card goes at once rather than when the agent next redraws: the moment
   * between a press and an agent's next frame is exactly how long a question
   * that has been answered must not still be standing on the graph. The session
   * puts its own copy away for the same reason, so a refusal — the question
   * moved on before the press landed — brings the new one back rather than the
   * one that was pressed.
   */
  const answer = useCallback(
    (id: string, ask: Ask, key: string) => {
      settle(id, null);
      void answerAsk(id, ask.seq, key).catch(() => undefined);
    },
    [settle],
  );

  return { asks, answer };
}

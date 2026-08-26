import { listen } from "@tauri-apps/api/event";
import { useCallback, useEffect, useRef, useState } from "react";

import {
  type Ask,
  answerAsk,
  askingNow,
  onAsking,
  pickAsk,
  pointAsk,
  replyAsk,
  takeAsk,
} from "../lib/ask";
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

  /**
   * Answers one by writing at it, and takes the card with it.
   *
   * The same as taking an answer, because it is the same thing: the question is
   * a turn, and it has been taken. What is written is the whole of the answer,
   * whether the question was a line on its own or the row of a list the agent's
   * mark is standing in.
   */
  const reply = useCallback(
    (id: string, ask: Ask, text: string) => {
      settle(id, null);
      void replyAsk(id, ask.seq, text).catch(() => undefined);
    },
    [settle],
  );

  /**
   * Moves the agent's own mark, or picks one of the answers up.
   *
   * The two that leave the question standing, which is the whole of what
   * separates them from the two above: nothing is settled and nothing is taken
   * off the graph. What comes back is the agent's next drawing of the same
   * question, through the same event as every other drawing of it — the mark
   * somewhere else, or a box filled in — and the card follows that rather than
   * anything guessed at here. A card that drew what it had asked for would be a
   * card saying something the terminal had not done yet.
   */
  const point = useCallback((id: string, ask: Ask, key: string) => {
    void pointAsk(id, ask.seq, key).catch(() => undefined);
  }, []);

  const pick = useCallback((id: string, ask: Ask, key: string) => {
    void pickAsk(id, ask.seq, key).catch(() => undefined);
  }, []);

  /**
   * Takes the question where it stands, and takes the card with it.
   *
   * The end of the kind of question a key does not answer — see `takeAsk` —
   * and settled here for the same reason an answer is: the moment between a
   * press and the agent's next frame is exactly how long a question that has
   * been taken must not still be standing on the graph.
   */
  const take = useCallback(
    (id: string, ask: Ask) => {
      settle(id, null);
      void takeAsk(id, ask.seq).catch(() => undefined);
    },
    [settle],
  );

  return { asks, answer, reply, point, pick, take };
}

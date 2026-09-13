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
import { onShellExit } from "../lib/pty";
import type { Session } from "../lib/session";
import { watchReadings } from "../lib/watchReadings";

const NOTHING: ReadonlyMap<string, Ask> = new Map();

// An agent draws its box in frames; a card that appears and vanishes within this is flicker.
const SETTLE_MS = 120;

export function useAsks() {
  const [asks, setAsks] = useState<ReadonlyMap<string, Ask>>(NOTHING);
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
    const timers = settling.current;
    const stop = watchReadings(
      { listen: onAsking, read: askingNow, exit: onShellExit },
      ({ id, ask }) => hold(id, ask),
      (id) => settle(id, null),
      ({ id, ask }) => settle(id, ask),
    );

    return () => {
      stop();
      for (const timer of timers.values()) window.clearTimeout(timer);
      timers.clear();
    };
  }, [hold, settle]);

  // The card goes at once, not on the agent's next frame; a refusal brings the new question back.
  const answer = useCallback(
    ({ id }: Session, ask: Ask, key: string) => {
      settle(id, null);
      void answerAsk(id, ask.seq, key).catch(() => undefined);
    },
    [settle],
  );

  const reply = useCallback(
    ({ id }: Session, ask: Ask, text: string) => {
      settle(id, null);
      void replyAsk(id, ask.seq, text).catch(() => undefined);
    },
    [settle],
  );

  // These leave the question standing: the card follows the agent's next drawing rather than
  // guessing.
  const point = useCallback(({ id }: Session, ask: Ask, key: string) => {
    void pointAsk(id, ask.seq, key).catch(() => undefined);
  }, []);

  const pick = useCallback(({ id }: Session, ask: Ask, key: string) => {
    void pickAsk(id, ask.seq, key).catch(() => undefined);
  }, []);

  const take = useCallback(
    ({ id }: Session, ask: Ask) => {
      settle(id, null);
      void takeAsk(id, ask.seq).catch(() => undefined);
    },
    [settle],
  );

  return { asks, answer, reply, point, pick, take };
}

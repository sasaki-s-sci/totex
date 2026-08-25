/**
 * What the window does with an answer to a question a session is asking.
 *
 * Held still, because the graph's actions are context: a callback rebuilt on
 * every render is every node on the canvas told that something changed.
 */

import { useCallback } from "react";
import type { Ask } from "../lib/ask";
import type { Session } from "../lib/session";
import type { useAsks } from "./useAsks";

export function useAskActions({
  answer,
  reply,
  point,
  pick,
  compose,
  take,
}: Omit<ReturnType<typeof useAsks>, "asks">) {
  const answerAsk = useCallback(
    (session: Session, ask: Ask, key: string) => answer(session.id, ask, key),
    [answer],
  );

  const replyToAsk = useCallback(
    (session: Session, ask: Ask, text: string) => reply(session.id, ask, text),
    [reply],
  );

  // And the four that work the question rather than end it. Three of them
  // leave it standing — the mark moved, an answer picked up, words written at
  // the row the mark is in — and the fourth is the return that ends the kinds
  // of question no key ends.
  const pointAtAsk = useCallback(
    (session: Session, ask: Ask, key: string) => point(session.id, ask, key),
    [point],
  );

  const pickInAsk = useCallback(
    (session: Session, ask: Ask, key: string) => pick(session.id, ask, key),
    [pick],
  );

  const composeAtAsk = useCallback(
    (session: Session, ask: Ask, text: string) => compose(session.id, ask, text),
    [compose],
  );

  const takeAsking = useCallback((session: Session, ask: Ask) => take(session.id, ask), [take]);

  return { answerAsk, replyToAsk, pointAtAsk, pickInAsk, composeAtAsk, takeAsking };
}

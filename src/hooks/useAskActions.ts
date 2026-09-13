// Held still: the canvas actions are context.

import { useCallback } from "react";
import type { Ask } from "../lib/ask";
import type { Session } from "../lib/session";
import type { useAsks } from "./useAsks";

export function useAskActions({
  answer,
  reply,
  point,
  pick,
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

  const pointAtAsk = useCallback(
    (session: Session, ask: Ask, key: string) => point(session.id, ask, key),
    [point],
  );

  const pickInAsk = useCallback(
    (session: Session, ask: Ask, key: string) => pick(session.id, ask, key),
    [pick],
  );

  const takeAsking = useCallback((session: Session, ask: Ask) => take(session.id, ask), [take]);

  return { answerAsk, replyToAsk, pointAtAsk, pickInAsk, takeAsking };
}

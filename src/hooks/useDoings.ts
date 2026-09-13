import { useCallback, useEffect, useState } from "react";

import { type Doing, doingNow, onDoing } from "../lib/doing";
import { onShellExit } from "../lib/pty";
import { watchReadings } from "../lib/watchReadings";

const NOTHING: ReadonlyMap<string, Doing> = new Map();

// Not held back like a question: a state is only sent when it changed.
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

  useEffect(
    () =>
      watchReadings(
        { listen: onDoing, read: doingNow, exit: onShellExit },
        ({ id, doing }) => put(id, doing),
        (id) => put(id, null),
      ),
    [put],
  );

  return doings;
}

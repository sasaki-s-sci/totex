import { useEffect, useRef } from "react";
import { useAppSettings } from "../lib/appSettings";
import { serve, servingNow, stopServing } from "../lib/mcp";

/**
 * Keeps the door standing, or not, as `mcpServing` in totex.json says. Nothing in the window
 * switches it: the port is asked afresh each start, and a failure is left for the next change.
 */
export function useServing(): void {
  const wanted = useAppSettings().mcpServing;
  const operations = useRef(Promise.resolve());
  useEffect(() => {
    let alive = true;
    operations.current = operations.current.then(async () => {
      if (!alive) return;
      try {
        const port = await servingNow();
        if (wanted && port === null) await serve();
        if (!wanted && port !== null) await stopServing();
      } catch {}
    });
    return () => {
      alive = false;
    };
  }, [wanted]);
}

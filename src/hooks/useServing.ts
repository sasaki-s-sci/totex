import { useEffect, useRef } from "react";
import { useAppSettings } from "../lib/appSettings";
import { serve, servingNow, stopServing } from "../lib/mcp";

/** Starts the fixed listener on launch; Settings preparation exposes errors and retries. */
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

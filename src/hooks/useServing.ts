import { useCallback, useEffect, useRef, useState } from "react";
import { updateSettings, useAppSettings } from "../lib/appSettings";
import {
  type Agent,
  setups as askSetups,
  install,
  type Setup,
  serve,
  servingNow,
  stopServing,
} from "../lib/mcp";

export type Installing = "rest" | "working" | "done" | "failed";

export type ServingControls = {
  serving: boolean;
  activity: "checking" | "idle" | "changing" | "failed";
  change: (next: boolean) => void;
  setups: Setup[];
  installing: Partial<Record<Agent, Installing>>;
  register: (agent: Agent) => void;
};

// Remembered is whether there should be a server; the port is asked afresh each start.
export function useServing(): ServingControls {
  const [serving, setServing] = useState(false);
  const [activity, setActivity] = useState<ServingControls["activity"]>("checking");
  const [setups, setSetups] = useState<Setup[]>([]);
  const [installing, setInstalling] = useState<ServingControls["installing"]>({});

  // Re-asked whenever the door moves: one line carries the port.
  const read = useCallback(() => {
    askSetups()
      .then(setSetups)
      .catch(() => setSetups([]));
  }, []);

  const wanted = useAppSettings().mcpServing;
  const operations = useRef(Promise.resolve());
  const [retry, setRetry] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: retry requests the same operation again after a server failure
  useEffect(() => {
    let alive = true;
    setActivity("changing");
    operations.current = operations.current.then(async () => {
      if (!alive) return;
      try {
        const port = await servingNow();
        if (wanted && port === null) await serve();
        if (!wanted && port !== null) await stopServing();
        if (alive) {
          setServing(wanted);
          setActivity("idle");
          read();
        }
      } catch {
        if (alive) {
          try {
            setServing((await servingNow()) !== null);
          } catch {}
          setActivity("failed");
        }
      }
    });
    return () => {
      alive = false;
    };
  }, [wanted, read, retry]);
  const change = useCallback((next: boolean) => {
    updateSettings({ mcpServing: next });
    setRetry((attempt) => attempt + 1);
  }, []);

  const register = useCallback((agent: Agent) => {
    setInstalling((was) => ({ ...was, [agent]: "working" }));
    install(agent)
      .then(() => setInstalling((was) => ({ ...was, [agent]: "done" })))
      .catch(() => setInstalling((was) => ({ ...was, [agent]: "failed" })));
  }, []);

  return { serving, activity, change, setups, installing, register };
}

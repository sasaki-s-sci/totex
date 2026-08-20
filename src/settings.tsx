import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from "react";

import { AGENT_IDS, type AgentId } from "./lib/agents";
import type { Surface } from "./lib/session";

/** The few choices that are the window's and not a repository's. */
export type Settings = {
  /** Where an agent opens when its button on a branch is clicked. */
  surface: Surface;
  /** Which agents get a button on every branch, in the catalogue's order. */
  agents: AgentId[];
};

const KEY = "totex.settings";

/**
 * The terminal by default: it is the agent's own interface, and everything the
 * agent can do is in there. The chat panel is the narrower of the two — one run
 * of the agent per message — so it is chosen rather than fallen into.
 */
const DEFAULTS: Settings = { surface: "cli", agents: AGENT_IDS };

function read(): Settings {
  try {
    const stored = localStorage.getItem(KEY);
    if (!stored) return DEFAULTS;
    const parsed = JSON.parse(stored) as Partial<Settings>;
    const wanted = Array.isArray(parsed.agents) ? parsed.agents : null;
    return {
      surface: parsed.surface === "chat" ? "chat" : "cli",
      // Read back through the catalogue rather than trusted, so an agent that
      // has since been dropped cannot come back as a button with nothing behind
      // it — and so the order is always the catalogue's.
      agents: wanted ? AGENT_IDS.filter((id) => wanted.includes(id)) : DEFAULTS.agents,
    };
  } catch {
    return DEFAULTS;
  }
}

type Store = {
  settings: Settings;
  update: (change: Partial<Settings>) => void;
};

const SettingsContext = createContext<Store>({ settings: DEFAULTS, update: () => {} });

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState<Settings>(read);

  const update = useCallback((change: Partial<Settings>) => {
    setSettings((current) => {
      const next = { ...current, ...change };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        // A window that cannot remember the choice can still honour it.
      }
      return next;
    });
  }, []);

  const store = useMemo(() => ({ settings, update }), [settings, update]);
  return <SettingsContext.Provider value={store}>{children}</SettingsContext.Provider>;
}

export function useSettings(): Store {
  return useContext(SettingsContext);
}

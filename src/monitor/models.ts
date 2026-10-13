import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useState } from "react";
import type { MonitorAgent } from "../lib/appSettingsModel";

export type MonitorModel = { id: string; name: string; description: string | null };
export type MonitorModelList = {
  /** The host the list came from, e.g. "WSL · Ubuntu-24.04". */
  environment: string;
  models: MonitorModel[];
  current: string | null;
};
export type MonitorModelSource = { agent: MonitorAgent; command: string; args: string[] };
export type MonitorModelsState =
  | { status: "idle"; list: null; error: null }
  | { status: "loading"; list: null; error: null }
  | { status: "ready"; list: MonitorModelList; error: null }
  | { status: "failed"; list: null; error: string };

// Product names stay untranslated; only the custom entry goes through i18n.
const AGENT_LABELS: Record<Exclude<MonitorAgent, "custom">, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
};
export function agentLabel(agent: MonitorAgent, custom: string) {
  return agent === "custom" ? custom : AGENT_LABELS[agent];
}

/** Only a custom agent is defined by its command; the built-in ones ignore it. */
function request(source: MonitorModelSource): MonitorModelSource {
  return source.agent === "custom" ? source : { agent: source.agent, command: "", args: [] };
}
export function modelSourceKey(source: MonitorModelSource) {
  const { agent, command, args } = request(source);
  return JSON.stringify([agent, command, args]);
}

// Listing starts the agent CLI and takes seconds, so one answer serves the whole session.
const cache = new Map<string, Promise<MonitorModelList>>();
// Settled answers, so reopening Settings draws the list without a loading flash.
const answers = new Map<string, MonitorModelList>();
function listModels(source: MonitorModelSource, fresh: boolean) {
  const key = modelSourceKey(source);
  const known = cache.get(key);
  if (known && !fresh) return known;
  const pending = invoke<MonitorModelList>("monitor_models", request(source));
  cache.set(key, pending);
  // A failure is not remembered: the next look retries instead of repeating a stale error.
  pending.then(
    (list) => {
      if (cache.get(key) === pending) answers.set(key, list);
    },
    () => {
      if (cache.get(key) !== pending) return;
      cache.delete(key);
      answers.delete(key);
    },
  );
  return pending;
}

const LOADING: MonitorModelsState = { status: "loading", list: null, error: null };
const IDLE: MonitorModelsState = { status: "idle", list: null, error: null };

export function useMonitorModels(source: MonitorModelSource) {
  const key = modelSourceKey(source);
  const [state, setState] = useState<MonitorModelsState>(LOADING);
  const [round, setRound] = useState({ key, fresh: false, count: 0 });
  useEffect(() => {
    let live = true;
    const [agent, command, args] = JSON.parse(key) as [MonitorAgent, string, string[]];
    // A custom agent without a command has nothing to ask yet.
    if (agent === "custom" && !command.trim()) {
      setState(IDLE);
      return;
    }
    const fresh = round.key === key && round.fresh;
    const known = fresh ? undefined : answers.get(key);
    if (known) {
      setState({ status: "ready", list: known, error: null });
      return;
    }
    setState(LOADING);
    listModels({ agent, command, args }, fresh).then(
      (list) => live && setState({ status: "ready", list, error: null }),
      (reason) => live && setState({ status: "failed", list: null, error: String(reason) }),
    );
    return () => {
      live = false;
    };
  }, [key, round]);
  const refresh = useCallback(
    () => setRound((last) => ({ key, fresh: true, count: last.count + 1 })),
    [key],
  );
  return { ...state, refresh };
}

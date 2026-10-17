import { invoke } from "@tauri-apps/api/core";
import { useEffect, useSyncExternalStore } from "react";
import { useAppSettings } from "../lib/appSettings";
import { notifications } from "../lib/notifications";
import { type Glance, isAgent, type MonitorSnapshot, type Observation, remember } from "./model";

const changes = notifications();
let snapshots = new Map<string, MonitorSnapshot>();
let glances = new Map<string, Glance>();
let histories = new Map<string, Observation[]>();
const NO_HISTORY: Observation[] = [];
// The screen is cheap to read, unlike the observer, so status follows it closely.
const GLANCE_MS = 1000;
let failure: string | null = null;
let configureQueue: Promise<unknown> = Promise.resolve();
export function useMonitorSnapshot(id: string) {
  return useSyncExternalStore(changes.subscribe, () => snapshots.get(id));
}
export function useMonitorGlance(id: string) {
  return useSyncExternalStore(changes.subscribe, () => glances.get(id));
}
export function useMonitorHistory(id: string) {
  return useSyncExternalStore(changes.subscribe, () => histories.get(id) ?? NO_HISTORY);
}
export function useMonitorError() {
  return useSyncExternalStore(changes.subscribe, () => failure);
}
export function useMonitorRuntime() {
  const { monitor } = useAppSettings();
  const key = JSON.stringify(monitor);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout>;
    let glanceTimer: ReturnType<typeof setTimeout>;
    const config = JSON.parse(key);
    // The service holds the bytes and this window the reading of them, so it is told which sessions are agents.
    let agents: string | null = null;
    snapshots = new Map();
    glances = new Map();
    histories = new Map();
    failure = null;
    changes.notify();
    const poll = async () => {
      try {
        const next = await invoke<MonitorSnapshot[]>("monitor_snapshots");
        if (!live) return;
        snapshots = new Map(next.map((snapshot) => [snapshot.id, snapshot]));
        histories = new Map(
          next.map((snapshot) => [
            snapshot.id,
            remember(histories.get(snapshot.id) ?? NO_HISTORY, snapshot),
          ]),
        );
        failure = null;
        changes.notify();
      } catch (error) {
        if (!live) return;
        snapshots = new Map();
        failure = String(error);
        changes.notify();
      }
      if (live) timer = setTimeout(poll, 1500);
    };
    const glance = async () => {
      try {
        const next = await invoke<Glance[]>("pty_standing");
        if (!live) return;
        const ids = next.filter((one) => isAgent(one)).map((one) => one.id);
        if (ids.sort().join("\n") !== agents) {
          agents = ids.join("\n");
          void invoke("monitor_agents", { ids }).catch(() => {
            agents = null;
          });
        }
        // Keep unchanged glances as the same objects so badges only redraw on a change.
        let changed = next.length !== glances.size;
        const kept = new Map<string, Glance>();
        for (const one of next) {
          const was = glances.get(one.id);
          const same =
            was?.doing === one.doing && was.asking === one.asking && was.said === one.said;
          if (!same) changed = true;
          kept.set(one.id, same && was ? was : one);
        }
        if (changed) {
          glances = kept;
          changes.notify();
        }
      } catch {
        // A missed glance leaves the last one standing; the next tick reads again.
      }
      if (live) glanceTimer = setTimeout(glance, GLANCE_MS);
    };
    // Serialize settings changes so a slow older request cannot restore stale configuration.
    configureQueue = configureQueue
      .catch(() => undefined)
      .then(async () => {
        if (!live) return;
        await invoke("monitor_configure", { config });
        if (!live) return;
        if (config.enabled) {
          void poll();
          void glance();
        } else {
          snapshots = new Map();
          failure = null;
          changes.notify();
        }
      })
      .catch((error) => {
        if (live) {
          failure = String(error);
          changes.notify();
        }
      });
    return () => {
      live = false;
      clearTimeout(timer);
      clearTimeout(glanceTimer);
    };
  }, [key]);
}

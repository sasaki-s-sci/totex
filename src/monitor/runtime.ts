import { invoke } from "@tauri-apps/api/core";
import { useEffect, useSyncExternalStore } from "react";
import { useAppSettings } from "../lib/appSettings";
import { notifications } from "../lib/notifications";
import type { MonitorSnapshot } from "./model";

const changes = notifications();
let snapshots = new Map<string, MonitorSnapshot>();
let failure: string | null = null;
let configureQueue: Promise<unknown> = Promise.resolve();
export function useMonitorSnapshot(id: string) {
  return useSyncExternalStore(changes.subscribe, () => snapshots.get(id));
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
    const config = JSON.parse(key);
    snapshots = new Map();
    failure = null;
    changes.notify();
    const poll = async () => {
      try {
        const next = await invoke<MonitorSnapshot[]>("monitor_snapshots");
        if (!live) return;
        snapshots = new Map(next.map((snapshot) => [snapshot.id, snapshot]));
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
    // Serialize settings changes so a slow older request cannot restore stale configuration.
    configureQueue = configureQueue
      .catch(() => undefined)
      .then(async () => {
        if (!live) return;
        await invoke("monitor_configure", { config });
        if (!live) return;
        if (config.enabled) void poll();
        else {
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
    };
  }, [key]);
}

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

export type TerminalUsage = {
  id: string;
  cwd: string;
  /** Percent of the whole machine's CPU; null until a second reading gives a rate. */
  cpu: number | null;
  /** Resident memory of the terminal's processes, in bytes. */
  memory: number;
};

const EVERY_MS = 2000;

/** The terminals' usage, read every few seconds while `enabled`; empty until the first reading lands. */
export function useTerminalUsage(enabled: boolean): TerminalUsage[] {
  const [usage, setUsage] = useState<TerminalUsage[]>([]);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const read = async () => {
      try {
        const next = await invoke<TerminalUsage[]>("terminal_usage");
        if (live) setUsage(next);
      } catch {
        if (live) setUsage([]);
      }
      if (live) timer = setTimeout(read, EVERY_MS);
    };
    void read();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [enabled]);
  return usage;
}

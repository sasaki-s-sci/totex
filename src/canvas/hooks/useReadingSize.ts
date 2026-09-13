import { useEffect, useSyncExternalStore } from "react";
import { settingsNow, subscribeSettings, updateSettings } from "../../lib/appSettings";
import { reading } from "../../lib/keys";

const SMALLEST = 8;
const LARGEST = 20;

const STEP = 1;

function clamp(size: number): number {
  return Math.min(LARGEST, Math.max(SMALLEST, Math.round(size)));
}
function snapshot(): number {
  return settingsNow().readingSize;
}
function resize(by: number) {
  updateSettings({ readingSize: clamp(snapshot() + by) });
}
export function useReadingSize(): number {
  return useSyncExternalStore(subscribeSettings, snapshot, snapshot);
}

// +, = and NumpadAdd all mean plus; shifted _ belongs to the terminal.
function stepOf(event: KeyboardEvent): number {
  if (event.key === "+" || event.key === "=" || event.code === "NumpadAdd") return STEP;
  if (event.key === "-" || event.code === "NumpadSubtract") return -STEP;
  return 0;
}

export function useReadingKeys() {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const by = stepOf(event);
      if (by === 0) return;
      event.preventDefault();
      if (reading(event.target)) resize(by);
    };

    // Captured and defaulted: WebKit opens a symbol chooser on Ctrl+; (JP layouts) and Windows scales the window on Ctrl+-.
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}

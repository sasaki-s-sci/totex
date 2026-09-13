import { invoke } from "@tauri-apps/api/core";

// Documents go to the persistent half as opaque JSON; webview storage is only the copy
// available before the socket answers, and `prime` brings it up to date.
const REMEMBERED = ["totex.roots", "totex.places"] as const;

export function remember(name: string, value: unknown): void {
  try {
    localStorage.setItem(name, JSON.stringify(value));
  } catch {}
  invoke("persistent_put", { name, value }).catch(() => undefined);
}

export async function prime(): Promise<void> {
  await Promise.all(
    REMEMBERED.map(async (name) => {
      let kept: unknown;
      try {
        kept = await invoke<unknown>("persistent_get", { name });
      } catch {
        return;
      }
      try {
        if (kept === null || kept === undefined) {
          const here = localStorage.getItem(name);
          if (here !== null) {
            invoke("persistent_put", { name, value: JSON.parse(here) }).catch(() => undefined);
          }
          return;
        }
        localStorage.setItem(name, JSON.stringify(kept));
      } catch {}
    }),
  );
}

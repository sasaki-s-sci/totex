const token = location.hash.slice(1);
const callbacks = new Map<number, (...args: unknown[]) => unknown>();
const listeners = new Map<number, { event: string; handler: number }>();
let serial = 0;
let watched: string[] = [];

/** Only the canvas API is available here; this is never a Tauri command transport. */
export async function canvasRequest<T>(
  command: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const response = await fetch("/api", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ command, args }),
    credentials: "omit",
    cache: "no-store",
  });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error ?? "The canvas connection failed.");
  return value;
}

const native = {
  metadata: {
    currentWindow: { label: "canvas-browser" },
    currentWebview: { label: "canvas-browser" },
  },
  convertFileSrc(path: string) {
    return `${location.origin}/media/${token}/${encodeURIComponent(path)}`;
  },
  transformCallback(callback: (...args: unknown[]) => unknown) {
    callbacks.set(++serial, callback);
    return serial;
  },
  unregisterCallback(id: number) {
    callbacks.delete(id);
  },
  async invoke(command: string, args: Record<string, unknown> = {}) {
    if (command === "plugin:event|listen") {
      const id = ++serial;
      listeners.set(id, { event: String(args.event), handler: Number(args.handler) });
      return id;
    }
    if (command === "plugin:event|unlisten") {
      listeners.delete(Number(args.eventId));
      return null;
    }
    if (command === "watch_directories") {
      watched = args.paths as string[];
      return null;
    }
    if (command === "plugin:opener|open_url") {
      const url = new URL(String(args.url));
      if (!["http:", "https:", "mailto:"].includes(url.protocol))
        throw new Error("Unsupported URL");
      window.open(url.href, "_blank", "noopener,noreferrer");
      return null;
    }
    if (command === "plugin:clipboard-manager|write_text") {
      await navigator.clipboard.writeText(String(args.text));
      return null;
    }
    if (command === "plugin:clipboard-manager|read_text") return navigator.clipboard.readText();
    return canvasRequest(command, args);
  },
};

Object.assign(window, {
  __TOTEX_BROWSER_CANVAS__: true,
  __TOTEX_NATIVE__: native,
  __TAURI_INTERNALS__: native,
  __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener() {} },
});

// Browser documents cannot share the native window's filesystem watcher subscriptions.
setInterval(() => {
  for (const [id, listener] of listeners) {
    if (listener.event === "fs:changed")
      callbacks.get(listener.handler)?.({ event: listener.event, id, payload: watched });
  }
}, 1500);

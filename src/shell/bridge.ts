import type { Connection } from "./protocol";

// This module must run before any frontend dependency calls a native API.
export const connection: Connection | undefined =
  window.parent === window ? undefined : window.parent.__TOTEX_SHELL__?.connect(window);

type Native = {
  invoke(command: string, args?: Record<string, unknown>, options?: unknown): Promise<unknown>;
  transformCallback(callback?: (...args: unknown[]) => unknown, once?: boolean): number;
  unregisterCallback(id: number): void;
};
const callbacks = new Set<number>();
const listeners = new Map<number, string>();
const registrations = new Set<Promise<unknown>>();
let native: Native | undefined;
if (connection) {
  // Match the native window's direct drag regions, including macOS double-click cancellation.
  const mac = navigator.platform.startsWith("Mac");
  let doubleClick: { x: number; y: number } | undefined;
  const isRegion = (event: MouseEvent) =>
    event.target instanceof HTMLElement &&
    ["", "true"].includes(event.target.getAttribute("data-tauri-drag-region") ?? "false");
  document.addEventListener("mousedown", (event) => {
    if (frontInactive() || event.button !== 0 || ![1, 2].includes(event.detail) || !isRegion(event))
      return;
    if (mac && event.detail === 2) {
      doubleClick = { x: event.clientX, y: event.clientY };
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    void native?.invoke(
      `plugin:window|${event.detail === 2 ? "internal_toggle_maximize" : "start_dragging"}`,
    );
  });
  document.addEventListener("mouseup", (event) => {
    if (!mac || frontInactive() || event.button !== 0 || event.detail !== 2) return;
    if (doubleClick?.x === event.clientX && doubleClick.y === event.clientY && isRegion(event))
      void native?.invoke("plugin:window|internal_toggle_maximize");
    doubleClick = undefined;
  });
  const parent = window.parent as unknown as Record<string, unknown>;
  const here = window as unknown as Record<string, unknown>;
  // WebView2 injects read-only Tauri globals into subframes too. The SDK
  // transform in vite.config.ts reads these slots without overwriting them.
  here.__TOTEX_EVENTS__ = parent.__TAURI_EVENT_PLUGIN_INTERNALS__;
  native = parent.__TAURI_INTERNALS__ as Native | undefined;
  if (native) {
    const owner = native;
    here.__TOTEX_NATIVE__ = Object.create(
      owner,
      Object.getOwnPropertyDescriptors({
        transformCallback(callback?: (...args: unknown[]) => unknown, once?: boolean) {
          const id = owner.transformCallback((...args) => {
            if (once) callbacks.delete(id);
            if (!retiring) return callback?.(...args);
          }, once);
          callbacks.add(id);
          return id;
        },
        unregisterCallback(id: number) {
          callbacks.delete(id);
          owner.unregisterCallback(id);
        },
        invoke(command: string, args?: Record<string, unknown>, options?: unknown) {
          if (retiring && command !== "plugin:event|unlisten")
            return Promise.reject(new Error("Frontend has retired"));
          if (command === "plugin:event|unlisten") listeners.delete(args?.eventId as number);
          const result = owner.invoke(command, args, options);
          if (command === "plugin:event|listen") {
            const registration = result.then((id) =>
              listeners.set(id as number, args?.event as string),
            );
            registrations.add(registration);
            void registration
              .finally(() => registrations.delete(registration))
              .catch(() => undefined);
          }
          return result;
        },
      }),
    );
  }
}

export let retiring = false;
export function frontInactive(): boolean {
  return (
    retiring || Boolean(connection && (window.frameElement as HTMLIFrameElement | null)?.inert)
  );
}
export function retire(): void {
  retiring = true;
}
export async function disconnect(): Promise<void> {
  await Promise.allSettled([...registrations]);
  const events = (
    window as unknown as {
      __TOTEX_EVENTS__?: { unregisterListener(event: string, id: number): void };
    }
  ).__TOTEX_EVENTS__;
  await Promise.allSettled(
    [...listeners].map(([eventId, event]) => {
      events?.unregisterListener(event, eventId);
      return native?.invoke("plugin:event|unlisten", { event, eventId });
    }),
  );
  listeners.clear();
  for (const id of callbacks) native?.unregisterCallback(id);
  callbacks.clear();
}

const pending = new Set<Promise<unknown>>();
let startupFailure: unknown;
export function readyAfter<T>(promise: Promise<T>): Promise<T> {
  pending.add(promise);
  void promise.catch((reason) => {
    startupFailure = reason;
  });
  void promise.finally(() => pending.delete(promise)).catch(() => undefined);
  return promise;
}
export async function settled(): Promise<void> {
  do {
    await Promise.all([...pending]);
    // State updates can mount another component with its own asynchronous attachment.
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (startupFailure !== undefined) throw startupFailure;
  } while (pending.size);
}

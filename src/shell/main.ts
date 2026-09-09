import { contract } from "virtual:shell-identity";
import { invoke } from "@tauri-apps/api/core";
import type { Connection, Front, Snapshot } from "./protocol";

type Page = {
  frame: HTMLIFrameElement;
  front?: Front;
  snapshot?: Snapshot;
  ready: Promise<Front>;
  resolve(front: Front): void;
  reject(reason: unknown): void;
};
const pages = new Set<Page>();
let active: Page | undefined;
let busy = false;

window.__TOTEX_SHELL__ = {
  connect(source): Connection {
    const page = [...pages].find((page) => page.frame.contentWindow === source);
    if (!page) throw new Error("Unknown frontend");
    return {
      snapshot: page.snapshot,
      install(front) {
        page.front = front;
      },
      ready() {
        if (page.front) page.resolve(page.front);
      },
      failed: page.reject,
      activate: (version) => {
        if (page !== active) return Promise.reject(new Error("Frontend is not active"));
        return activate(version);
      },
    };
  },
};

function stage(snapshot?: Snapshot): Page {
  let resolve!: (front: Front) => void;
  let reject!: (reason: unknown) => void;
  const ready = new Promise<Front>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const frame = document.createElement("iframe");
  frame.title = "totex";
  frame.style.cssText = "position:fixed;inset:0;width:100%;height:100%;border:0;visibility:hidden";
  frame.inert = true;
  const page: Page = { frame, snapshot, ready, resolve, reject };
  pages.add(page);
  const timer = setTimeout(() => reject(new Error("Frontend startup timed out")), 30_000);
  void ready.finally(() => clearTimeout(timer)).catch(() => undefined);
  frame.src = `/front.html?at=${Date.now()}`;
  document.body.append(frame);
  return page;
}

async function discard(page: Page): Promise<void> {
  try {
    await page.front?.dispose();
  } finally {
    page.frame.remove();
    pages.delete(page);
  }
}

/** The old page remains painted until startup and native confirmation both succeed. */
async function activate(expected?: string): Promise<void> {
  if (busy || !active?.front) throw new Error("Frontend activation is already in progress");
  busy = true;
  const old = active;
  const current = active.front;
  let candidate: Page | undefined;
  let undo: (() => void) | undefined;
  try {
    const response = await fetch(`/ephemeral.json?at=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) throw new Error("Frontend manifest is unavailable");
    const manifest = await response.json();
    if (
      manifest.schema !== 2 ||
      manifest.contract !== contract ||
      (expected && manifest.version !== expected)
    )
      throw new Error("This frontend requires a different shell");

    if (manifest.viewsContract === current.views()) {
      undo = await current.swap(manifest.version);
      await invoke("confirm_front", { version: manifest.version });
    } else {
      const snapshot = await current.snapshot();
      if (snapshot.schema !== 1) throw new Error("Unsupported frontend state");
      old.frame.inert = true;
      candidate = stage(snapshot);
      const front = await candidate.ready;
      if (front.version() !== manifest.version || front.views() !== manifest.viewsContract)
        throw new Error("The prepared frontend does not match the staged release");
      await invoke("confirm_front", { version: manifest.version });
      active = candidate;
      candidate.frame.style.visibility = "visible";
      candidate.frame.inert = false;
      old.frame.style.visibility = "hidden";
      candidate.front?.focus();
      // The update was requested from the old frame. Let its awaiting call unwind before disposal.
      const retired = old;
      setTimeout(() => void discard(retired).catch(console.error), 0);
    }
  } catch (reason) {
    undo?.();
    if (candidate) await discard(candidate).catch(console.error);
    await invoke("rollback_front").catch(() => undefined);
    throw reason;
  } finally {
    if (active === old) {
      if (old.frame.inert) {
        old.frame.inert = false;
        old.front?.focus();
      }
    }
    busy = false;
  }
}

const initial = stage();
try {
  await initial.ready;
  active = initial;
  initial.frame.style.visibility = "visible";
  initial.frame.inert = false;
  document.getElementById("root")?.remove();
  initial.front?.focus();
  await invoke("confirm_front", { version: null }).catch(() => undefined);
} catch (reason) {
  await discard(initial);
  const message = document.createElement("p");
  message.textContent = "totex could not open. Restart the app to try again.";
  document.body.append(message);
  console.error(reason);
}

import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";
import {
  type AppSettings,
  legacySettings,
  type SettingsPatch,
  settingsFrom,
} from "./appSettingsModel";
import { notifications } from "./notifications";

export type SettingsDocument = { path: string; text: string; value: AppSettings };
const changes = notifications();
const legacy = legacySettings((key) => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
});
let settings = legacy;
let document: SettingsDocument | null = null;
let error: string | null = null;
let pending: SettingsPatch = {};
let timer: ReturnType<typeof setTimeout> | undefined;
let queue: Promise<void> = Promise.resolve();

export const subscribeSettings = changes.subscribe;
export const settingsNow = () => settings;
export const settingsDocument = () => document;
export const settingsError = () => error;
export function useAppSettings() {
  return useSyncExternalStore(changes.subscribe, settingsNow, settingsNow);
}
export function useSettingsDocument() {
  return useSyncExternalStore(changes.subscribe, settingsDocument, settingsDocument);
}
export function useSettingsError() {
  return useSyncExternalStore(changes.subscribe, settingsError, settingsError);
}

function merge(one: SettingsPatch, two: SettingsPatch): SettingsPatch {
  return {
    ...one,
    ...two,
    ...(one.said || two.said ? { said: { ...one.said, ...two.said } } : {}),
    ...(one.appearance || two.appearance
      ? { appearance: { ...one.appearance, ...two.appearance } }
      : {}),
  };
}
function accept(next: SettingsDocument) {
  document = next;
  settings = settingsFrom({
    ...next.value,
    ...pending,
    appearance: { ...next.value.appearance, ...pending.appearance },
    said: { ...next.value.said, ...pending.said },
  });
  error = null;
  cacheBootTheme();
  changes.notify();
}
/** Only the pre-paint HTML reads this cache; the JSON document is authoritative. */
function cacheBootTheme() {
  try {
    localStorage.setItem("totex.mode", settings.theme);
  } catch {}
}

function refused(reason: unknown) {
  error = String(reason);
  changes.notify();
}

export async function loadSettings(): Promise<void> {
  try {
    accept(await invoke<SettingsDocument>("app_settings_read", { initial: legacy }));
  } catch (reason) {
    refused(reason);
  }
}

/** On returning from an external editor, without discarding pending UI edits. */
export function refreshSettings(): Promise<void> {
  queue = queue.then(async () => {
    if (Object.keys(pending).length === 0) await loadSettings();
  });
  return queue;
}

export function updateSettings(patch: SettingsPatch): void {
  pending = merge(pending, patch);
  settings = settingsFrom({
    ...settings,
    ...patch,
    appearance: { ...settings.appearance, ...patch.appearance },
    said: { ...settings.said, ...patch.said },
  });
  cacheBootTheme();
  changes.notify();
  clearTimeout(timer);
  timer = setTimeout(() => {
    void flushSettings();
  }, 100);
}

export function flushSettings(): Promise<void> {
  clearTimeout(timer);
  queue = queue.then(async () => {
    if (Object.keys(pending).length === 0) return;
    const patch = pending;
    pending = {};
    try {
      accept(await invoke<SettingsDocument>("app_settings_patch", { patch }));
    } catch (reason) {
      pending = merge(patch, pending);
      refused(reason);
    }
  });
  return queue;
}

/** A failed write must keep the old frontend, where the unsaved settings still live. */
export async function flushSettingsForHandoff(): Promise<void> {
  await flushSettings();
  if (Object.keys(pending).length) throw new Error("Settings could not be saved before updating");
}

export async function writeSettingsText(text: string, expected: string): Promise<number> {
  await flushSettings();
  let size = 0;
  let failure: unknown;
  queue = queue.then(async () => {
    try {
      const next = await invoke<SettingsDocument>("app_settings_write", { text, expected });
      accept(next);
      size = new TextEncoder().encode(next.text).length;
    } catch (reason) {
      failure = reason;
      refused(reason);
    }
  });
  await queue;
  if (failure !== undefined) throw failure;
  return size;
}

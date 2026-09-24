// Every theme the window knows: the built-ins, and whatever ~/.totex/themes holds right now.
// Reloaded on focus, so a file dropped in by hand or by an agent is there when the window is
// next looked at; nothing is built in at compile time that a file could not also say.
import { invoke } from "@tauri-apps/api/core";
import { useSyncExternalStore } from "react";

import { notifications } from "../lib/notifications";
import {
  type ColorsDeclaration,
  type Declaration,
  type EffectsDeclaration,
  type LayerKind,
  readDeclaration,
  type StyleDeclaration,
} from "./declaration";

export const THEMES_DIRECTORY = "~/.totex/themes";

export const DEFAULT_APPEARANCE = { colors: "neon", style: "default", effects: "none" } as const;
export type Appearance = Record<LayerKind, string>;

/** One file under the themes directory, read or refused. */
export type ThemeFile =
  | { path: string; ok: true; value: Declaration }
  | { path: string; ok: false; error: string };

export type Resolved = {
  colors: ColorsDeclaration;
  style: StyleDeclaration;
  effects: EffectsDeclaration;
};

type Kinds = { colors: ColorsDeclaration; style: StyleDeclaration; effects: EffectsDeclaration };

// Every file in builtin/ ships; adding one is the whole change. The defaults lead each list,
// the rest follow by file name.
const BUILTIN: readonly Declaration[] = Object.entries(
  import.meta.glob<unknown>("./builtin/*.json", { eager: true, import: "default" }),
)
  .map(([path, source]) => {
    const read = readDeclaration(source);
    if (!read.ok) throw new Error(`Built-in theme ${path}: ${read.error}`);
    return read.value;
  })
  .sort(
    (one, two) =>
      Number(two.id === DEFAULT_APPEARANCE[two.kind]) -
      Number(one.id === DEFAULT_APPEARANCE[one.kind]),
  );

const changes = notifications();
let files: readonly ThemeFile[] = [];
let loadError: string | null = null;

export const subscribeThemes = changes.subscribe;
export const themeFilesNow = () => files;
export const themesErrorNow = () => loadError;

/** Built-ins first; a user file with a built-in's id replaces it in place. */
export function declarationsOf<K extends LayerKind>(kind: K): Kinds[K][] {
  const byId = new Map<string, Declaration>();
  for (const declaration of BUILTIN) byId.set(`${declaration.kind}:${declaration.id}`, declaration);
  for (const file of files)
    if (file.ok) byId.set(`${file.value.kind}:${file.value.id}`, file.value);
  return [...byId.values()].filter(
    (declaration): declaration is Kinds[K] => declaration.kind === kind,
  );
}

export function resolveAppearance(appearance: Appearance): Resolved {
  return {
    colors: pick("colors", appearance.colors),
    style: pick("style", appearance.style),
    effects: pick("effects", appearance.effects),
  };
}

// An id that names nothing, a file deleted or misspelled, falls back rather than failing the window.
function pick<K extends LayerKind>(kind: K, id: string): Kinds[K] {
  const all = declarationsOf(kind);
  return (
    all.find((declaration) => declaration.id === id) ??
    all.find((declaration) => declaration.id === DEFAULT_APPEARANCE[kind]) ??
    (all[0] as Kinds[K])
  );
}

export function useThemeFiles(): readonly ThemeFile[] {
  return useSyncExternalStore(changes.subscribe, themeFilesNow, themeFilesNow);
}

export function useThemesError(): string | null {
  return useSyncExternalStore(changes.subscribe, themesErrorNow, themesErrorNow);
}

/** Replaces the user files wholesale; exported so tests and fixtures can inject without Tauri. */
export function setThemeFiles(next: readonly { path: string; text: string }[]): void {
  files = next.map(({ path, text }) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (reason) {
      return { path, ok: false, error: String(reason) };
    }
    const read = readDeclaration(parsed);
    return read.ok ? { path, ok: true, value: read.value } : { path, ok: false, error: read.error };
  });
  loadError = null;
  changes.notify();
}

let lastText = "";

export async function loadThemes(): Promise<void> {
  try {
    const next = await invoke<{ path: string; text: string }[]>("themes_read");
    // Focus reloads often; only a real change re-renders every themed thing.
    const text = JSON.stringify(next);
    if (text === lastText && loadError === null) return;
    lastText = text;
    setThemeFiles(next);
  } catch (reason) {
    loadError = String(reason);
    changes.notify();
  }
}

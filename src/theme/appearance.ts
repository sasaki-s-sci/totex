import { useMemo, useSyncExternalStore } from "react";

import { settingsNow, useAppSettings } from "../lib/appSettings";
import { type Resolved, resolveAppearance, subscribeThemes, themeFilesNow } from "./registry";

/** The three layers the settings name, looked up in what is loaded now. */
export function useAppearance(): Resolved {
  const { appearance } = useAppSettings();
  const files = useSyncExternalStore(subscribeThemes, themeFilesNow, themeFilesNow);
  // biome-ignore lint/correctness/useExhaustiveDependencies: `files` is the registry's version; a new list is a new lookup
  return useMemo(
    () => resolveAppearance(appearance),
    [appearance.colors, appearance.style, appearance.effects, files],
  );
}

/** Outside React: before the first render, and for code that is not a component. */
export function appearanceNow(): Resolved {
  return resolveAppearance(settingsNow().appearance);
}

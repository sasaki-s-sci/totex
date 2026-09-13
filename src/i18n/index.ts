import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { settingsNow, subscribeSettings, updateSettings } from "../lib/appSettings";
import en from "./locales/en.json";
import japanese from "./locales/ja.json";

export const LOCALES = ["en", "ja"] as const;

export type Locale = (typeof LOCALES)[number];

export type LanguageMode = "system" | Locale;

export const FALLBACK_LOCALE: Locale = "en";

// English is the shape: a key added to en.json is a type error until ja.json answers it.
const ja: typeof en = japanese;

// Primary subtag only: `ja-JP` reads `ja`.
function preferred(): Locale {
  const asked = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of asked) {
    const base = tag.toLowerCase().split("-")[0];
    const found = LOCALES.find((locale) => locale === base);
    if (found) return found;
  }
  return FALLBACK_LOCALE;
}

export function storedLanguage(): LanguageMode {
  return settingsNow().language;
}

function languageFor(mode: LanguageMode): Locale {
  return mode === "system" ? preferred() : mode;
}

void i18next.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    ja: { translation: ja },
  },
  lng: languageFor(storedLanguage()),
  fallbackLng: FALLBACK_LOCALE,
  interpolation: {
    // React escapes already, and these strings go to screen readers, not markup.
    escapeValue: false,
  },
});

// index.html cannot set it; the language is only settled here.
document.documentElement.lang = i18next.resolvedLanguage ?? FALLBACK_LOCALE;

export function changeLanguage(mode: LanguageMode): void {
  updateSettings({ language: mode });
}

let appliedLanguage = storedLanguage();
subscribeSettings(() => {
  const mode = storedLanguage();
  if (mode === appliedLanguage) return;
  appliedLanguage = mode;
  void i18next.changeLanguage(languageFor(mode)).then(() => {
    document.documentElement.lang = i18next.resolvedLanguage ?? FALLBACK_LOCALE;
  });
});

export default i18next;

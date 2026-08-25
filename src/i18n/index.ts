/**
 * The window's words, and the one place they are held.
 *
 * Almost nothing here is a sentence: the marks say what they do, and what this
 * carries is what something reading the window aloud is given in their place.
 * That is exactly the text that cannot be drawn, so it is the text that has to
 * be written down somewhere a translator can reach — a locale file, rather than
 * a literal wedged between two JSX tags.
 *
 * The language starts as the operating system's, asked of the webview. It can
 * be chosen explicitly in settings when this window needs a different answer.
 * Anything not translated falls back to English, which is also the language
 * the code is written in.
 */

import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./locales/en.json";
import japanese from "./locales/ja.json";

/** Every language the window can be read in. English is the one it falls back to. */
export const LOCALES = ["en", "ja"] as const;

export type Locale = (typeof LOCALES)[number];

/** A language named outright, or the machine's own answer. */
export type LanguageMode = "system" | Locale;

export const FALLBACK_LOCALE: Locale = "en";

/** Where an explicit choice is kept. Its absence means to follow the machine. */
export const LANGUAGE_KEY = "totex.language";

/* English is the shape every other locale is held to: a key added to en.json is
   a type error here until ja.json answers it, which is a cheaper way to find a
   missing translation than opening the window and looking for it. */
const ja: typeof en = japanese;

/**
 * The first language the reader asked for that this window has words in.
 *
 * `navigator.languages` is their whole list in the order they ranked it, and
 * only the primary subtag is matched: somebody set to `ja-JP` reads the same
 * Japanese as somebody set to `ja`, and a region this app has no separate words
 * for should not fall all the way back to English.
 */
function preferred(): Locale {
  const asked = navigator.languages?.length ? navigator.languages : [navigator.language];
  for (const tag of asked) {
    const base = tag.toLowerCase().split("-")[0];
    const found = LOCALES.find((locale) => locale === base);
    if (found) return found;
  }
  return FALLBACK_LOCALE;
}

/** The last choice made in settings, or the machine's own if none was made. */
export function storedLanguage(): LanguageMode {
  try {
    const stored = localStorage.getItem(LANGUAGE_KEY);
    if (stored === "en" || stored === "ja" || stored === "system") return stored;
  } catch {
    // A window that cannot remember the choice still follows the machine.
  }
  return "system";
}

/** The catalogue a choice resolves to right now. */
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
    // React escapes everything it renders, and these strings are read by
    // screen readers rather than parsed as markup. Escaping twice would put
    // entities into a file name that only ever had an ampersand in it.
    escapeValue: false,
  },
});

/* The document says which language it is in once that is settled, so a screen
   reader picks the voice for it. index.html cannot: it is written before anyone
   has been asked. */
document.documentElement.lang = i18next.resolvedLanguage ?? FALLBACK_LOCALE;

/** Remember and immediately apply a choice made in settings. */
export async function changeLanguage(mode: LanguageMode): Promise<void> {
  try {
    localStorage.setItem(LANGUAGE_KEY, mode);
  } catch {
    // The choice still applies to this window even when it cannot be kept.
  }
  await i18next.changeLanguage(languageFor(mode));
  document.documentElement.lang = i18next.resolvedLanguage ?? FALLBACK_LOCALE;
}

export default i18next;

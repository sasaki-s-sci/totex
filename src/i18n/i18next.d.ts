/**
 * What `t()` is allowed to be given.
 *
 * Without this every key is a string and a typo is a runtime miss that shows up
 * as the key itself drawn on the screen. With it, English is the catalogue: the
 * keys in en.json are the only ones that compile, and their interpolations are
 * checked too.
 */

import type en from "./locales/en.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof en };
  }
}

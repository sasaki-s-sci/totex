import type en from "./locales/en.json";

// Keys in en.json are the only ones that compile.
declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof en };
  }
}

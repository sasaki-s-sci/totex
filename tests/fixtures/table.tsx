import i18next from "i18next";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { initReactI18next } from "react-i18next";
import { TableReading } from "../../src/components/nodes/preview/TableReading";
import en from "../../src/i18n/locales/en.json";

void i18next.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en } } });
const text =
  'Name,Count,Note\r\n"ten, item",10,"first\nsecond"\r\ntwo,2,"a ""quote"""\r\n' +
  Array.from({ length: 105 }, (_, index) => `row${index},${100 + index},<b>literal</b>`).join("\n");
const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(
  <StrictMode>
    <section style={{ width: 600, height: 400 }}>
      <TableReading text={text} path="sample.csv" />
    </section>
  </StrictMode>,
);

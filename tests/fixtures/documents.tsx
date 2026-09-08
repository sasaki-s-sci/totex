import i18next from "i18next";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { initReactI18next } from "react-i18next";
import { DxfReading } from "../../src/components/nodes/preview/DxfReading";
import { PdfReading } from "../../src/components/nodes/preview/PdfReading";
import en from "../../src/i18n/locales/en.json";
import "../../src/canvas/reading.css";

void i18next.use(initReactI18next).init({ lng: "en", resources: { en: { translation: en } } });

function pdfSource() {
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ...["First page", "Second page"].map((text) => {
      const stream = `BT /F1 24 Tf 30 150 Td (${text}) Tj ET\n`;
      return `<< /Length ${stream.length} >>\nstream\n${stream}endstream`;
    }),
  ];
  let text = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(text.length);
    text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = text.length;
  text += `xref\n0 8\n0000000000 65535 f \n`;
  text += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  text += `trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return `data:application/pdf;base64,${btoa(text)}`;
}
const pdf = pdfSource();
const dxf =
  "data:application/octet-stream;base64," +
  btoa(
    `${[
      0,
      "SECTION",
      2,
      "ENTITIES",
      0,
      "LINE",
      8,
      "0",
      10,
      0,
      20,
      0,
      11,
      100,
      21,
      100,
      0,
      "CIRCLE",
      8,
      "0",
      10,
      50,
      20,
      50,
      40,
      25,
      0,
      "TEXT",
      8,
      "0",
      10,
      0,
      20,
      110,
      40,
      10,
      1,
      "DXF preview",
      0,
      "ENDSEC",
      0,
      "EOF",
    ].join("\n")}\n`,
  );

function Fixture() {
  const [visible, setVisible] = useState(true);
  const [broken, setBroken] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setVisible(!visible)}>
        Toggle viewers
      </button>
      <button type="button" onClick={() => setBroken(!broken)}>
        Toggle broken
      </button>
      {visible && (
        <div style={{ display: "flex", gap: 20 }}>
          <section aria-label="PDF" style={{ width: 560, height: 480, flexShrink: 0 }}>
            <PdfReading
              key={String(broken)}
              source={broken ? "data:;base64,YnJva2Vu" : pdf}
              name="sample.pdf"
            />
          </section>
          <section aria-label="DXF" style={{ width: 560, height: 480, flexShrink: 0 }}>
            <DxfReading source={dxf} name="sample.dxf" />
          </section>
        </div>
      )}
    </>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);

import JSZip from "jszip";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { EpubReading } from "../../src/components/nodes/preview/EpubReading";

const zip = new JSZip();
zip.file("mimetype", "application/epub+zip");
zip.file(
  "META-INF/container.xml",
  `<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="book/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`,
);
zip.file(
  "book/package.opf",
  `<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="id">preview-test</dc:identifier><dc:title>Fixture</dc:title><dc:language>en</dc:language><meta property="dcterms:modified">2026-09-09T00:00:00Z</meta></metadata><manifest><item id="nav" href="nav.xhtml" properties="nav" media-type="application/xhtml+xml"/><item id="one" href="one.xhtml" media-type="application/xhtml+xml"/><item id="two" href="two" media-type="application/xhtml+xml"/><item id="css" href="style.css" media-type="text/css"/><item id="pixel" href="pixel.png" media-type="image/png"/></manifest><spine><itemref idref="one"/><itemref idref="two"/></spine></package>`,
);
zip.file(
  "book/nav.xhtml",
  `<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops"><head><title>Contents</title></head><body><nav epub:type="toc"><ol><li><a href="one.xhtml">First chapter</a></li><li><a href="two">Second chapter</a></li></ol></nav></body></html>`,
);
for (const [file, heading, next] of [
  ["one.xhtml", "First chapter", "two"],
  ["two", "Second chapter", "one.xhtml"],
])
  zip.file(
    `book/${file}`,
    `<html xmlns="http://www.w3.org/1999/xhtml"><head><title>${heading}</title><link rel="stylesheet" href="style.css"/><script>parent.document.body.dataset.compromised='yes'</script><meta http-equiv="refresh" content="0;url=https://preview-test.invalid/refresh"/></head><body><h1>${heading}</h1><img alt="Book pixel" src="pixel.png"/><a href="${next}">Other chapter</a><a href="https://preview-test.invalid/escape" target="_top">External link</a><img src="https://preview-test.invalid/tracker" onerror="parent.document.body.dataset.compromised='yes'"/></body></html>`,
  );
zip.file(
  "book/style.css",
  `@import url("https://preview-test.invalid/style"); h1 {color:rgb(20,70,130)} body{background:white}`,
);
zip.file(
  "book/pixel.png",
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/iZk9HQAAAABJRU5ErkJggg==",
  { base64: true },
);
const valid = `data:application/epub+zip;base64,${await zip.generateAsync({ type: "base64", compression: "DEFLATE" })}`;
function Fixture() {
  const [source, setSource] = useState(valid);
  const [visible, setVisible] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setSource("data:application/epub+zip;base64,YmFk")}>
        Invalid
      </button>
      <button type="button" onClick={() => setSource(valid)}>
        Valid
      </button>
      <button type="button" onClick={() => setVisible((value) => !value)}>
        Toggle
      </button>
      <section style={{ width: 640, height: 480 }}>
        {visible && <EpubReading source={source} name="Fixture" />}
      </section>
    </>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing root");
createRoot(root).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);

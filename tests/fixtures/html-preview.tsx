import { createRoot } from "react-dom/client";
import { HtmlReading } from "../../src/components/nodes/preview/HtmlReading";

const source = `<!doctype html><html lang="ja"><head>
  <title>Sample document</title>
  <meta http-equiv="refresh" content="0;url=https://preview-test.invalid/refresh">
  <base href="https://preview-test.invalid/">
  <link rel="stylesheet" href="https://preview-test.invalid/style.css">
  <style>
    @import url("https://preview-test.invalid/import.css");
    body { margin: 24px; background: rgb(245, 247, 250); }
    .layout { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
    h1 { color: rgb(20, 70, 130); }
    .external { background-image: url("https://preview-test.invalid/background.png"); }
  </style>
  <script>parent.document.body.dataset.compromised = 'yes';</script>
</head><body>
  <h1>Styled HTML 日本語</h1>
  <div class="layout"><p>Left column</p><p>Right column</p></div>
  <div class="external">External resources must not load</div>
  <a href="https://preview-test.invalid/navigation" target="_top">Inert link</a>
  <form action="https://preview-test.invalid/submit"><input name="secret"><button>Submit</button></form>
  <img src="https://preview-test.invalid/image.png" onerror="parent.document.body.dataset.compromised='yes'">
  <img alt="Embedded pixel" src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==">
  <svg width="80" height="40"><rect width="80" height="40" fill="teal" /></svg>
  <iframe src="https://preview-test.invalid/frame"></iframe>
</body></html>`;

const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(
  <section style={{ width: 640, height: 480 }}>
    <HtmlReading text={source} />
  </section>,
);

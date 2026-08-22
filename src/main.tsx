import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
// Side effect: settles the language and loads the catalogues before anything
// calls `useTranslation`.
import "./i18n";
import { applyStoredMode } from "./theme";

// Which of the two palettes the window opens in, written onto the document
// before anything is drawn from it. The provider settles the same thing an
// effect later, which is a frame after the first paint -- long enough to see.
applyStoredMode();

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root is missing from index.html");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

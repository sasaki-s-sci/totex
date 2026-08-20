import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
// Side effect: settles the language and loads the catalogues before anything
// calls `useTranslation`.
import "./i18n";

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root is missing from index.html");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

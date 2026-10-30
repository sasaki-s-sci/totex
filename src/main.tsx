// Install the IPC bridge before application modules evaluate.
import "./shell/bridge";
import { StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ephemeralIdentity, swapEphemeral } from "./ephemeral/runtime";
import { canvasPart, settingsPart, sidebarPart, worktreePart } from "./parts";
import { connection, disconnect, retire, settled } from "./shell/bridge";
import { captureFocus, restoreFocus } from "./shell/focus";
import { snapshot, takeCarried } from "./shell/state";
// Side effect: settles the language before anything calls `useTranslation`.
import "./i18n";
import {
  flushSettings,
  flushSettingsForHandoff,
  loadSettings,
  refreshSettings,
} from "./lib/appSettings";
import { prime } from "./lib/remembered";
import { isCardWindow } from "./lib/thisWindow";
import { askStanding } from "./lib/update/store";
import { applyStoredMode } from "./theme";
import { loadThemes } from "./theme/registry";

// Written before the first paint; the provider settles the same thing an effect later.
applyStoredMode();

// On the element rather than in a sheet, so nothing the theme writes onto the body paints over it.
if (isCardWindow()) {
  document.documentElement.classList.add("is-card-window");
  document.documentElement.style.background = "transparent";
  document.body.style.background = "transparent";
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root is missing from index.html");
}

// One loopback round trip before the column reads where it was; see `remembered`.
const root = createRoot(container, {
  onUncaughtError(reason) {
    connection?.failed(reason);
    console.error(reason);
  },
});
let disposed = false;
connection?.install({
  async snapshot() {
    captureFocus();
    await flushSettingsForHandoff();
    return snapshot();
  },
  async dispose() {
    disposed = true;
    await flushSettings();
    retire();
    root.unmount();
    await disconnect();
  },
  views: () => ephemeralIdentity().contract,
  version: () => ephemeralIdentity().version,
  swap: swapEphemeral,
  focus() {
    restoreFocus();
    // Startup can read the previous version before the shell confirms this frontend.
    void askStanding(true);
  },
});

Promise.all([
  prime(),
  isCardWindow() ? undefined : takeCarried(),
  loadSettings(),
  loadThemes(),
  swapEphemeral(),
  canvasPart.warm(),
  ...(connection?.snapshot
    ? [sidebarPart, settingsPart, worktreePart].map((part) => part.warm())
    : []),
])
  .then(async () => {
    if (disposed) return;
    applyStoredMode();
    window.addEventListener("focus", () => {
      void refreshSettings();
      void loadThemes();
    });
    window.addEventListener("pagehide", () => {
      void flushSettings();
    });
    flushSync(() =>
      root.render(
        <StrictMode>
          <App />
        </StrictMode>,
      ),
    );
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await settled();
    if (!disposed) connection?.ready();
  })
  .catch((reason) => {
    connection?.failed(reason);
    console.error(reason);
  });

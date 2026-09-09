// Install the IPC bridge before application modules evaluate.
import "./shell/bridge";
import { StrictMode } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import App from "./App";
import { ephemeralIdentity, swapEphemeral } from "./ephemeral/runtime";
import { commitPart, graphPart, panelPart, settingsPart, tasksPart, worktreePart } from "./parts";
import { connection, disconnect, retire, settled } from "./shell/bridge";
import { captureFocus, restoreFocus } from "./shell/focus";
import { snapshot } from "./shell/state";
// Side effect: settles the language and loads the catalogues before anything
// calls `useTranslation`.
import "./i18n";
import {
  flushSettings,
  flushSettingsForHandoff,
  loadSettings,
  refreshSettings,
} from "./lib/appSettings";
import { prime } from "./lib/remembered";
import { applyStoredMode } from "./theme";

// Which of the two palettes the window opens in, written onto the document
// before anything is drawn from it. The provider settles the same thing an
// effect later, which is a frame after the first paint -- long enough to see.
applyStoredMode();

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root is missing from index.html");
}

// What the last window left with the persistent half, brought across before the column
// reads where it was -- see `remembered`. One round trip on the loopback,
// which is nothing beside the first paint.
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
  focus: restoreFocus,
});

Promise.all([
  prime(),
  loadSettings(),
  swapEphemeral(),
  graphPart.warm(),
  ...(connection?.snapshot
    ? [panelPart, settingsPart, commitPart, worktreePart, tasksPart].map((part) => part.warm())
    : []),
])
  .then(async () => {
    if (disposed) return;
    applyStoredMode();
    window.addEventListener("focus", () => {
      void refreshSettings();
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

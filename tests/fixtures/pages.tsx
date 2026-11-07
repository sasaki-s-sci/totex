import { ThemeProvider } from "@mui/material/styles";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { loadSettings } from "../../src/lib/appSettings";
import { keepFrontValue, snapshot } from "../../src/shell/state";
import { appearanceNow, themeFrom } from "../../src/theme";
import "../../src/i18n";

if (location.search.includes("terminal-resize")) {
  const { Terminal } = await import("@xterm/xterm");
  const terminals = new Map<string, InstanceType<typeof Terminal>>();
  const open = Terminal.prototype.open;
  Terminal.prototype.open = function (parent) {
    open.call(this, parent);
    terminals.set(parent.dataset.terminal ?? "", this);
  };
  Object.assign(window, { pageTerminals: terminals });
}

keepFrontValue("sessions.list", [
  { id: "terminal-one", cwd: "/tmp", branch: "main" },
  ...(location.search.includes("grouped")
    ? [
        { id: "terminal-two", cwd: "/tmp", branch: "worker" },
        { id: "terminal-other", cwd: "/elsewhere", branch: "other" },
      ]
    : []),
]);
keepFrontValue(
  "files.open",
  location.search.includes("onlyterminals")
    ? []
    : [{ id: 1, path: "/tmp/note.txt", folder: "/tmp", at: { x: 380, y: 240 } }],
);
keepFrontValue("window.settings", 1);
if (
  location.search.includes("offers") ||
  location.search.includes("terminals") ||
  location.search.includes("mixed")
) {
  keepFrontValue("folders.panes", [
    {
      id: 0,
      kind: "folder",
      path: "/tmp",
      open: location.search.includes("mixed"),
      graphed: !location.search.includes("offers") ? ["/tmp"] : ["/empty-a", "/empty-b"],
      expanded: [],
      shown: {},
    },
  ]);
}
await loadSettings();
const { colors, style } = appearanceNow();
const theme = themeFrom(colors, style);
const { Window } = await import("../../src/window/Window");
Object.assign(window, { pageSnapshot: snapshot });
const root = document.getElementById("root");
if (!root) throw new Error("Missing fixture root");
createRoot(root).render(
  <StrictMode>
    <ThemeProvider theme={theme}>
      <Window />
    </ThemeProvider>
  </StrictMode>,
);
